const COMMON_WIDGETS = ["widget.welcome", "widget.alerts"] as const;

export const CONTRACT_MENUS = {
  ISO: ["orders", "tickets"],
  TEST: ["orders", "tickets"],
};

export const CONTRACT_WIDGETS = {
  ISO: [
    ...COMMON_WIDGETS,
    "widget.quick", // preserved widget note
  ],
  TEST: [...COMMON_WIDGETS, "widget.quick"],
};
