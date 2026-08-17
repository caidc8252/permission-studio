import { parse } from "@babel/parser";

function unwrap(node) {
  let current = node;
  while (
    current &&
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "ParenthesizedExpression",
    ].includes(current.type)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property) {
  if (property.type !== "ObjectProperty") return null;
  if (property.computed) throw new Error("Computed catalog properties are unsupported");
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "StringLiteral") return property.key.value;
  throw new Error("Catalog property keys must be static strings");
}

function topLevelDeclarations(ast) {
  return ast.program.body.flatMap((statement) => {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    return declaration?.type === "VariableDeclaration" ? declaration.declarations : [];
  });
}

function parseCatalog(source) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
    errorRecovery: false,
  });
  const declarations = new Map();
  for (const declaration of topLevelDeclarations(ast)) {
    if (declaration.id.type === "Identifier" && declaration.init) {
      if (declarations.has(declaration.id.name)) {
        throw new Error(`Duplicate catalog owner ${declaration.id.name}`);
      }
      declarations.set(declaration.id.name, unwrap(declaration.init));
    }
  }
  return declarations;
}

function requiredDeclaration(declarations, name, type) {
  const value = declarations.get(name);
  if (!value) throw new Error(`Catalog owner ${name} was not found`);
  if (value.type !== type) {
    throw new Error(
      `Catalog owner ${name} must be a static ${type === "ArrayExpression" ? "array" : "object"}`,
    );
  }
  return value;
}

function stringValue(node, context) {
  const value = unwrap(node);
  if (value?.type !== "StringLiteral") throw new Error(`${context} must be a static string`);
  return value.value;
}

function staticArrayElements(array, declarations, seen = new Set()) {
  const values = [];
  for (const element of array.elements) {
    if (!element) throw new Error("Array holes are unsupported");
    if (element.type === "SpreadElement") {
      const argument = unwrap(element.argument);
      if (argument.type !== "Identifier" || seen.has(argument.name)) {
        throw new Error("Array spreads must reference a static top-level array");
      }
      const spread = requiredDeclaration(declarations, argument.name, "ArrayExpression");
      values.push(
        ...staticArrayElements(spread, declarations, new Set([...seen, argument.name])).map(
          (item) => ({ ...item, inheritedFrom: element }),
        ),
      );
      continue;
    }
    values.push({
      value: stringValue(element, "Array element"),
      node: element,
      inheritedFrom: null,
    });
  }
  return values;
}

function findObjectProperty(object, key) {
  let match;
  for (const property of object.properties) {
    if (property.type === "SpreadElement") throw new Error("Object spreads are unsupported");
    const name = propertyName(property);
    if (name === key) {
      if (match) throw new Error(`Duplicate catalog key ${key}`);
      match = property;
    }
  }
  if (!match) throw new Error(`Catalog key ${key} was not found`);
  return match;
}

function findOptionalObjectProperty(object, key) {
  let match;
  for (const property of object.properties) {
    if (property.type === "SpreadElement") throw new Error("Object spreads are unsupported");
    const name = propertyName(property);
    if (name === key) {
      if (match) throw new Error(`Duplicate catalog key ${key}`);
      match = property;
    }
  }
  return match;
}

function numberValue(node, context) {
  const value = unwrap(node);
  if (value?.type !== "NumericLiteral" || !Number.isInteger(value.value)) {
    throw new Error(`${context} must be a static integer`);
  }
  return value.value;
}

function findTargetArray(declarations, request) {
  if (request.owner === "GLOBAL_ROLES") {
    const roles = requiredDeclaration(declarations, request.owner, "ArrayExpression");
    let selected;
    const roleCodes = new Set();
    for (const element of roles.elements) {
      const role = unwrap(element);
      if (!role || role.type !== "ObjectExpression") {
        throw new Error("GLOBAL_ROLES entries must be static objects");
      }
      const codeProperty = findObjectProperty(role, "code");
      const code = stringValue(codeProperty.value, "Role code");
      if (roleCodes.has(code)) throw new Error(`Duplicate role code ${code}`);
      roleCodes.add(code);
      if (code === request.key) selected = role;
    }
    if (!selected) throw new Error(`Catalog key ${request.key} was not found`);
    const field = request.field ?? "permissionCodes";
    const property = findObjectProperty(selected, field);
    const value = unwrap(property.value);
    if (value.type !== "ArrayExpression") throw new Error(`${field} must be a static array`);
    return value;
  }

  if (!new Set(["CONTRACT_MENUS", "CONTRACT_WIDGETS"]).has(request.owner)) {
    throw new Error(`Unsupported catalog owner ${request.owner}`);
  }
  const owner = requiredDeclaration(declarations, request.owner, "ObjectExpression");
  const property = findObjectProperty(owner, request.key);
  const value = unwrap(property.value);
  if (value.type !== "ArrayExpression")
    throw new Error(`${request.owner}.${request.key} must be a static array`);
  return value;
}

function removalRange(source, array, node) {
  const close = array.end - 1;
  const after = source.slice(node.end, close);
  const trailingComma = after.match(/^\s*,/u);
  if (trailingComma)
    return { start: node.start, end: node.end + trailingComma[0].length, text: "" };
  const before = source.slice(array.start + 1, node.start);
  const comma = before.match(/,\s*$/u);
  if (comma) return { start: node.start - comma[0].length, end: node.end, text: "" };
  return { start: node.start, end: node.end, text: "" };
}

function additionEdit(source, array, additions) {
  if (!additions.length) return null;
  const close = array.end - 1;
  const arraySource = source.slice(array.start, array.end);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (arraySource.includes("\n")) {
    const closingLineStart = source.lastIndexOf("\n", close - 1) + 1;
    const closingIndent = source.slice(closingLineStart, close);
    const firstElement = array.elements.find(Boolean);
    const firstLineStart = firstElement ? source.lastIndexOf("\n", firstElement.start - 1) + 1 : -1;
    const elementIndent = firstElement
      ? source.slice(firstLineStart, firstElement.start)
      : `${closingIndent}  `;
    return {
      start: closingLineStart,
      end: closingLineStart,
      text: additions
        .map((value) => `${elementIndent}${JSON.stringify(value)},${newline}`)
        .join(""),
    };
  }
  const hasElements = array.elements.some(Boolean);
  const hasTrailingComma = /,\s*$/u.test(
    source.slice(array.elements.at(-1)?.end ?? array.start + 1, close),
  );
  const serialized = additions.map((value) => JSON.stringify(value)).join(", ");
  return {
    start: close,
    end: close,
    text: hasElements ? (hasTrailingComma ? ` ${serialized},` : `, ${serialized}`) : serialized,
  };
}

export function planSourceEdits(source, request) {
  const declarations = parseCatalog(source);
  const array = findTargetArray(declarations, request);
  const elements = staticArrayElements(array, declarations);
  const currentValues = new Set(elements.map(({ value }) => value));
  const removals = new Set(request.remove ?? []);
  const additions = [...new Set(request.add ?? [])].filter(
    (value) => !currentValues.has(value) || removals.has(value),
  );
  const edits = [];
  const handledSpreads = new Set();

  for (const element of elements) {
    if (!removals.has(element.value)) continue;
    if (!element.inheritedFrom) {
      edits.push(removalRange(source, array, element.node));
      continue;
    }
    if (handledSpreads.has(element.inheritedFrom)) continue;
    handledSpreads.add(element.inheritedFrom);
    const spreadValues = elements
      .filter((candidate) => candidate.inheritedFrom === element.inheritedFrom)
      .map(({ value }) => value)
      .filter((value) => !removals.has(value));
    if (spreadValues.length) {
      edits.push({
        start: element.inheritedFrom.start,
        end: element.inheritedFrom.end,
        text: spreadValues.map((value) => JSON.stringify(value)).join(", "),
      });
    } else {
      edits.push(removalRange(source, array, element.inheritedFrom));
    }
  }

  const addition = additionEdit(source, array, additions);
  if (addition) edits.push(addition);
  return edits;
}

function insertionIndent(source, collection) {
  const close = collection.end - 1;
  const closingLineStart = source.lastIndexOf("\n", close - 1) + 1;
  const closingIndent = source.slice(closingLineStart, close);
  const firstEntry = (collection.elements ?? collection.properties).find(Boolean);
  const firstLineStart = firstEntry ? source.lastIndexOf("\n", firstEntry.start - 1) + 1 : -1;
  return {
    close,
    closingLineStart,
    entryIndent: firstEntry ? source.slice(firstLineStart, firstEntry.start) : `${closingIndent}  `,
  };
}

export function planNewRoleEdit(source, role) {
  if (!Number.isInteger(role.roleId) || role.roleId < 1 || role.roleId >= 1000) {
    throw new Error("Role ID must be an integer from 1 to 999");
  }
  if (!/^preset_[a-z0-9_]+$/u.test(role.code)) {
    throw new Error("Role code must be a lowercase preset_ identifier");
  }
  if (
    !Array.isArray(role.permissionCodes) ||
    role.permissionCodes.some((code) => typeof code !== "string" || !code)
  ) {
    throw new Error("Role permission codes must be static strings");
  }
  const declarations = parseCatalog(source);
  const roles = requiredDeclaration(declarations, "GLOBAL_ROLES", "ArrayExpression");
  for (const element of roles.elements) {
    const candidate = unwrap(element);
    if (!candidate || candidate.type !== "ObjectExpression") {
      throw new Error("GLOBAL_ROLES entries must be static objects");
    }
    const candidateCode = stringValue(findObjectProperty(candidate, "code").value, "Role code");
    const idProperty = findOptionalObjectProperty(candidate, "roleId");
    const candidateId = idProperty ? numberValue(idProperty.value, "Role ID") : undefined;
    if (candidateCode === role.code) {
      if (candidateId === role.roleId) return [];
      throw new Error(`Duplicate role code ${role.code}`);
    }
    if (candidateId === role.roleId) throw new Error(`Duplicate role ID ${role.roleId}`);
  }

  const stem = role.code.replace(/_(.)/gu, (_, character) => character.toUpperCase());
  const serialized = JSON.stringify(
    {
      roleId: role.roleId,
      code: role.code,
      roleName: `role.${stem}`,
      remark: `role.${stem}Desc`,
      permissionCodes: [...new Set(role.permissionCodes)].sort(),
    },
    null,
    2,
  );
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (!source.slice(roles.start, roles.end).includes("\n")) {
    return [
      {
        start: roles.end - 1,
        end: roles.end - 1,
        text: `${roles.elements.length ? ", " : ""}${JSON.stringify({
          roleId: role.roleId,
          code: role.code,
          roleName: `role.${stem}`,
          remark: `role.${stem}Desc`,
          permissionCodes: [...new Set(role.permissionCodes)].sort(),
        })}`,
      },
    ];
  }
  const { closingLineStart, entryIndent } = insertionIndent(source, roles);
  const text = serialized
    .split("\n")
    .map((line) => `${entryIndent}${line}`)
    .join(newline);
  return [{ start: closingLineStart, end: closingLineStart, text: `${text},${newline}` }];
}

export function planRoleTranslationEdit(source, stem, name) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(stem)) {
    throw new Error("Role translation stem must be a static identifier");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Role translation name must be a non-empty string");
  }
  const declarations = parseCatalog(source);
  const messages = requiredDeclaration(declarations, "messages", "ObjectExpression");
  const roleProperty = findObjectProperty(messages, "role");
  const roleMessages = unwrap(roleProperty.value);
  if (roleMessages.type !== "ObjectExpression") throw new Error("messages.role must be an object");
  const entries = [
    [stem, name],
    [`${stem}Desc`, name],
  ];
  let present = 0;
  for (const [key, value] of entries) {
    const property = findOptionalObjectProperty(roleMessages, key);
    if (!property) continue;
    present += 1;
    if (stringValue(property.value, `messages.role.${key}`) !== value) {
      throw new Error(`Role translation key ${key} already exists`);
    }
  }
  if (present === entries.length) return [];
  if (present > 0) throw new Error(`Role translation keys for ${stem} are incomplete`);

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const { closingLineStart, entryIndent } = insertionIndent(source, roleMessages);
  return [
    {
      start: closingLineStart,
      end: closingLineStart,
      text: entries
        .map(([key, value]) => `${entryIndent}${key}: ${JSON.stringify(value)},${newline}`)
        .join(""),
    },
  ];
}

export function applySourceEdits(source, edits) {
  const ordered = [...edits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (const [index, edit] of ordered.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length
    ) {
      throw new Error("Source edit range is invalid");
    }
    const previous = ordered[index - 1];
    if (previous && edit.start < previous.end) throw new Error("Source edits overlap");
  }
  return [...ordered]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}
