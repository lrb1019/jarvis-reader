export interface FileLeaf<File> {
  openFile(file: File, options: { active: true }): Promise<void>;
}

export interface FileWorkspace<File> {
  getLeaf(newLeaf: "tab"): FileLeaf<File>;
  setActiveLeaf(leaf: FileLeaf<File>, options: { focus: true }): void;
}

export async function openFileInActiveTab<File>(
  workspace: FileWorkspace<File>,
  file: File,
): Promise<void> {
  const leaf = workspace.getLeaf("tab");
  await leaf.openFile(file, { active: true });
  workspace.setActiveLeaf(leaf, { focus: true });
}
