export const validModel = {
  schemaVersion: 1,
  sourceSha: "0123456789abcdef0123456789abcdef01234567",
  permissionCodes: ["orders.manage", "orders.view"],
  menuRegistry: {
    orders: {
      menuCode: "orders",
      title: "menu.orders",
      parentMenuCode: null,
      path: "/orders",
      icon: "shopping-cart",
      order: 10,
    },
  },
  permissionRegistry: {
    "orders.manage": {
      code: "orders.manage",
      belongToMenuCode: "orders",
      label: "permission.orders.manage",
      desc: "permission.orders.manageDesc",
    },
    "orders.view": {
      code: "orders.view",
      belongToMenuCode: "orders",
      label: "permission.orders.view",
      desc: "permission.orders.viewDesc",
    },
  },
  permissionAvailability: {},
  permissionAvailabilityBypassContracts: ["TEST"],
  contractScope: {
    ISO: ["orders.manage", "orders.view"],
    TEST: ["orders.manage", "orders.view"],
  },
  contractTypes: ["ISO", "TEST"],
  contractMenus: {
    ISO: ["orders"],
    TEST: ["orders"],
  },
  contractWidgets: {
    ISO: [],
    TEST: [],
  },
  contractPlanPolicies: {
    ISO: {
      plans: ["STANDARD", "ENTERPRISE"],
      permissionPlans: {
        "orders.manage": ["ENTERPRISE"],
      },
    },
  },
  roles: [
    {
      roleId: 10,
      code: "preset_ops",
      roleName: "role.ops",
      remark: "role.opsDesc",
      permissionCodes: ["orders.view"],
    },
  ],
  translations: {
    en: {
      "menu.orders": "Orders",
      "permission.orders.manage": "Manage orders",
      "permission.orders.manageDesc": "Manage order records.",
      "permission.orders.view": "View orders",
      "permission.orders.viewDesc": "View order records.",
      "role.ops": "Operations",
      "role.opsDesc": "Operations role.",
    },
    "zh-CN": {
      "menu.orders": "订单",
      "permission.orders.manage": "管理订单",
      "permission.orders.manageDesc": "管理订单记录。",
      "permission.orders.view": "查看订单",
      "permission.orders.viewDesc": "查看订单记录。",
      "role.ops": "运营",
      "role.opsDesc": "运营角色。",
    },
    ja: {
      "menu.orders": "注文",
      "permission.orders.manage": "注文を管理",
      "permission.orders.manageDesc": "注文レコードを管理します。",
      "permission.orders.view": "注文を表示",
      "permission.orders.viewDesc": "注文レコードを表示します。",
      "role.ops": "運用",
      "role.opsDesc": "運用ロール。",
    },
  },
} as const;
