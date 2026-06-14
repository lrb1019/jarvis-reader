import {FileView, Menu, TFile, WorkspaceLeaf} from "obsidian";
import * as React from 'react';
import {useState} from 'react';
import * as ReactDOM from 'react-dom';
import AwesomeReaderPlugin, {AwesomeReaderPluginSettings} from "./main";
import {getEpubTocMd, openOrCreateNote} from "./utils";
import {ReactReader, ReactReaderStyle} from "react-reader";

export const EpubReader = ({contents, title, scrolled, tocOffset, initLocation, saveLocation, tocMemo}: {
	contents: ArrayBuffer;
	title: string;
	scrolled: boolean;
	tocOffset: number;
	initLocation: string | number;
	saveLocation: Function;
	tocMemo: Function;
}) => {
	const [location, setLocation] = useState(initLocation);
	const locationChanged = (epubcifi: string | number) => {
		setLocation(epubcifi);
		saveLocation(epubcifi);
	};

	// @ts-ignore
	return <div className={"awesome-reader-epub"}
				style={{border: "none", height: "100%", width: "100%", overflow: "hidden"}}>
		<ReactReader
			title={title}
			showToc={true}
			location={location}
			locationChanged={locationChanged}
			swipeable={false}
			url={contents}
			tocChanged={toc => tocMemo(toc)}
			epubOptions={scrolled ? {
				allowPopups: false,
				flow: "scrolled",
				manager: "continuous"
			} : {
				allowPopups: false
			}}
			readerStyles={
				{
					...ReactReaderStyle,
					tocArea: {
						...ReactReaderStyle.tocArea,
						top: (tocOffset + 20).toString() + 'px',
						bottom: 0,
						left: 'auto',
						backgroundColor: 'currentColor',
					},
					tocButtonExpanded: {
						...ReactReaderStyle.tocButtonExpanded,
						backgroundColor: 'currentColor',
					}
				}
			}
		/>
	</div>;
};

export class EpubView extends FileView {
	allowNoFile: false;
	fileToc: null;

	constructor(leaf: WorkspaceLeaf, private settings: AwesomeReaderPluginSettings, private plugin: AwesomeReaderPlugin) {
		super(leaf);
	}

	onPaneMenu(menu: Menu,): void {
		menu.addItem((item) => {
			item
				.setTitle("Open/create book note")
				.setIcon("document")
				.onClick(async () => {
					await openOrCreateNote(this.app, this.file, getEpubTocMd(this.fileToc));
				});
		});
	}

	async setInitLocation(initLocation: string | number) {
		this.plugin.settings.bookInitLocations[this.file.path] = initLocation;
		await this.plugin.saveSettings();
	}

	async getInitLocation() {
		const location = this.plugin.settings.bookInitLocations[this.file.path];
		return location ? location : null;
	}


	async onLoadFile(file: TFile): Promise<void> {
		ReactDOM.unmountComponentAtNode(this.contentEl);
		this.contentEl.empty();
		// @ts-ignore
		const style = getComputedStyle(this.containerEl.parentElement.querySelector('div.view-header'));
		const width = parseFloat(style.width);
		const height = parseFloat(style.height);
		const tocOffset = height < width ? height : 0;

		const contents = await this.app.vault.readBinary(file);
		ReactDOM.render(
			<EpubReader
				contents={contents}
				title={file.basename}
				scrolled={this.settings.scrolledView}
				tocOffset={tocOffset}
				// @ts-ignore
				initLocation={await this.getInitLocation()}
				saveLocation={(location: string | number) => {
					this.setInitLocation(location);
				}}
				tocMemo={(toc: any) => {
					this.fileToc = toc;
				}}
			/>,
			this.contentEl
		);
	}

	onunload(): void {
		ReactDOM.unmountComponentAtNode(this.contentEl);
	}

	canAcceptExtension(extension: string) {
		return extension == "epub";
	}

	getViewType() {
		return "epub";
	}
}
