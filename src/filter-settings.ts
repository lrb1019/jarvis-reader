import { Menu } from "obsidian";

export interface FilterChoiceGroup {
  label: string;
  choices: { label: string; selected: boolean; choose: () => void }[];
}

/** Let Obsidian own menu appearance, selection, positioning and dismissal. */
export function showFilterMenu(anchor: HTMLElement, groups: FilterChoiceGroup[], onHide: () => void): Menu {
  const menu = new Menu();
  // Use Obsidian's themed menu rather than the operating system's appearance.
  // Older supported Obsidian versions do not expose this desktop option.
  if (typeof menu.setUseNativeMenu === "function") menu.setUseNativeMenu(false);
  groups.forEach((group, index) => {
    if (index) menu.addSeparator();
    menu.addItem(item => item.setTitle(group.label).setIsLabel(true));
    group.choices.forEach(choice => menu.addItem(item => item
      .setTitle(choice.label).setChecked(choice.selected).onClick(choice.choose)));
  });
  menu.onHide(onHide);
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, anchor.ownerDocument);
  return menu;
}
