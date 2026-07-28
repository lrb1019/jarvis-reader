export interface FileLeaf<File> {
  openFile(file: File, options: { active: true }): Promise<void>;
  view?: unknown;
}

export interface FileWorkspace<
  File,
  Leaf extends FileLeaf<File> = FileLeaf<File>,
> {
  getLeaf(newLeaf: "tab"): Leaf;
  setActiveLeaf(leaf: Leaf, options: { focus: true }): void;
}

export async function openFileInActiveTab<
  File,
  Leaf extends FileLeaf<File>,
>(
  workspace: FileWorkspace<File, Leaf>,
  file: File,
): Promise<Leaf> {
  const leaf = workspace.getLeaf("tab");
  await leaf.openFile(file, { active: true });
  workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

export interface ReusableFileWorkspace<
  File,
  Leaf extends FileLeaf<File> = FileLeaf<File>,
> extends FileWorkspace<File, Leaf> {
  getLeavesOfType(viewType: string): Leaf[];
}

export async function openFileOnceInActiveTab<
  File extends { path: string },
  Leaf extends FileLeaf<File>,
>(
  workspace: ReusableFileWorkspace<File, Leaf>,
  file: File,
  viewType: string,
): Promise<Leaf> {
  const existingLeaf = workspace.getLeavesOfType(viewType).find((leaf) => {
    const openFile = (leaf.view as { file?: { path?: string } } | undefined)?.file;
    return openFile?.path === file.path;
  });

  if (existingLeaf) {
    workspace.setActiveLeaf(existingLeaf, { focus: true });
    return existingLeaf;
  }

  return await openFileInActiveTab(workspace, file);
}
