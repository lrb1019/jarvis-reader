import 'src/styles.css';
import {App, Menu, MenuItem, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from 'obsidian';
import {EpubView} from "./EpubView";
import {getPdfTocMd, openOrCreateNote} from "./utils";

export interface AwesomeReaderPluginSettings {
	scrolledView: boolean;
	bookInitLocations: Record<string, string | number>;
}

const DEFAULT_SETTINGS: AwesomeReaderPluginSettings = {
	scrolledView: false,
	bookInitLocations: {}
};

export default class AwesomeReaderPlugin extends Plugin {
	settings: AwesomeReaderPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView("epub", (leaf: WorkspaceLeaf) => {
			return new EpubView(leaf, this.settings, this);
		});

		try {
			this.registerExtensions(["epub"], "epub");
		} catch (error) {
			console.log(`registerExtensions epub failed.`);
		}

		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(menu: Menu, file: TFile) => {
					if (file.extension.toLowerCase() === "pdf") {
						menu.addItem((item: MenuItem) => {
								item
									.setTitle("Open/create book note")
									.setIcon('document')
									.onClick(async () => {
										await openOrCreateNote(this.app, file, await getPdfTocMd(file));
									});
							}
						);
					}
				}
			),
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AwesomeReaderSettingTab(this.app, this));


	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AwesomeReaderSettingTab extends PluginSettingTab {
	plugin: AwesomeReaderPlugin;

	constructor(app: App, plugin: AwesomeReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Awesome Reader Settings'});

		new Setting(containerEl)
			.setName("Scrolled View")
			.setDesc("This enables seamless scrolling between pages.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.scrolledView)
				.onChange(async (value) => {
					this.plugin.settings.scrolledView = value;
					await this.plugin.saveSettings();
				}));
	}
}
