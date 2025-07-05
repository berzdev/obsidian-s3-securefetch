import { App, Notice, Plugin, PluginSettingTab, Setting, MarkdownView } from 'obsidian';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3SecureFetchSettings {
	matchUrl: string;
	paramKey: string;
	paramValue: string;
	useSignedUrl: boolean;
	s3AccessKeyId: string;
	s3SecretAccessKey: string;
	s3Region: string;
	s3Endpoint: string;
	s3Bucket: string;
}

const DEFAULT_SETTINGS: S3SecureFetchSettings = {
	matchUrl: '',
	paramKey: 'key',
	paramValue: '',
	useSignedUrl: false,
	s3AccessKeyId: '',
	s3SecretAccessKey: '',
	s3Region: '',
	s3Endpoint: '',
	s3Bucket: ''
}

export default class S3SecureFetchPlugin extends Plugin {
	settings: S3SecureFetchSettings;
	private originalWindowOpen: typeof window.open;

	async onload() {
		await this.loadSettings();

		this.interceptObsidianRequests();
		this.setupWorkspaceEventHandlers();
		this.setupMutationObserver();

		this.addRibbonIcon('link', 'Secure S3 Links', (evt: MouseEvent) => {
			this.processCurrentPageLinks();
		});

		this.addCommand({
			id: 'process-s3-links',
			name: 'Secure all S3 links on the current page',
			callback: () => {
				this.processCurrentPageLinks();
			}
		});

		this.addSettingTab(new S3SecureFetchSettingTab(this.app, this));

		console.log('S3 SecureFetch Plugin loaded');
		new Notice('S3 SecureFetch Plugin loaded');
	}

	onunload() {
		// Stelle window.open wieder her
		if (this.originalWindowOpen) {
			window.open = this.originalWindowOpen;
		}
		console.log('S3 SecureFetch Plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async processCurrentPageLinks() {
		if (!this.settings.matchUrl || (!this.settings.paramValue && !this.settings.useSignedUrl)) {
			new Notice('❌ Please configure the S3 SecureFetch plugin settings first!');
			return;
		}

		new Notice('🔍 Scanning current page for matching links...');
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('❌ No active markdown view found');
			return;
		}

		const containerEl = activeView.containerEl;
		let processedCount = 0;
		const mediaTypes = [
			{ selector: 'a[href]', attribute: 'href', type: 'Link' },
			{ selector: 'img[src]', attribute: 'src', type: 'Image' },
			{ selector: 'video[src]', attribute: 'src', type: 'Video' },
			{ selector: 'audio[src]', attribute: 'src', type: 'Audio' },
			{ selector: 'source[src]', attribute: 'src', type: 'Source' },
			{ selector: 'iframe[src]', attribute: 'src', type: 'Iframe' }
		];

		for (const { selector, attribute, type } of mediaTypes) {
			const elements = containerEl.querySelectorAll(selector);
			for (const element of Array.from(elements)) {
				const originalUrl = element.getAttribute(attribute);
				if (!originalUrl) continue;

				if (originalUrl.startsWith('app://') || originalUrl.startsWith('obsidian://') || originalUrl.startsWith('data:') || element.hasAttribute('data-auth-processed')) {
					continue;
				}

				if (this.shouldInterceptLink(originalUrl)) {
					const authenticatedUrl = await this.processUrl(originalUrl);
					element.setAttribute(attribute, authenticatedUrl);
					element.setAttribute('data-auth-processed', 'true');
					
					if (attribute === 'href' && element.tagName.toLowerCase() === 'a') {
						this.addClickInterceptor(element as HTMLAnchorElement, originalUrl);
					}
					
					(element as HTMLElement).title = `URL secured by S3 SecureFetch.\nOriginal: ${originalUrl}\nModified: ${authenticatedUrl}`;
					processedCount++;
				}
			}
		}

		if (processedCount > 0) {
			new Notice(`🎉 Successfully secured ${processedCount} link(s)!`);
		} else {
			new Notice(`ℹ️ No matching links found for pattern: ${this.settings.matchUrl}`);
		}
	}

	private addClickInterceptor(anchor: HTMLAnchorElement, originalHref: string) {
		anchor.setAttribute('data-original-url', originalHref);
		anchor.setAttribute('data-s3-secured', 'true');
		
		// Entferne vorherige Event Listener
		const newAnchor = anchor.cloneNode(true) as HTMLAnchorElement;
		anchor.parentNode?.replaceChild(newAnchor, anchor);
		
		newAnchor.setAttribute('data-original-url', originalHref);
		newAnchor.setAttribute('data-s3-secured', 'true');

		// Primärer Click Handler
		newAnchor.addEventListener('click', async (event) => {
			console.log('🔍 Click Interceptor ausgelöst für:', originalHref);
			new Notice(`🔍 S3 Link Match erkannt: ${originalHref.substring(0, 50)}...`);
			
			event.preventDefault();
			event.stopPropagation();
			
			const storedOriginalUrl = newAnchor.getAttribute('data-original-url') || originalHref;
			const authenticatedUrl = await this.processUrl(storedOriginalUrl);
			
			new Notice(`🔒 S3 Authentication successful`);
			console.log('🔐 Öffne signierte URL:', authenticatedUrl);
			window.open(authenticatedUrl, '_blank');
		}, true);

		// Zusätzlicher Handler für verschiedene Maus-Events
		newAnchor.addEventListener('mousedown', async (event) => {
			// Für Mittelklick (Mausrad) und Strg+Klick
			if (event.button === 1 || event.ctrlKey || event.metaKey) {
				console.log('🔍 Mittelklick/Strg+Klick abgefangen für:', originalHref);
				event.preventDefault();
				event.stopPropagation();
				
				const storedOriginalUrl = newAnchor.getAttribute('data-original-url') || originalHref;
				const authenticatedUrl = await this.processUrl(storedOriginalUrl);
				
				new Notice(`🔒 S3 Authentication successful`);
				window.open(authenticatedUrl, '_blank');
			}
		}, true);

		// Handler für Kontextmenü
		newAnchor.addEventListener('contextmenu', async (event) => {
			console.log('🔍 Kontextmenü für S3 Link:', originalHref);
			// Lassen wir das Kontextmenü zu, aber loggen es
		});
	}

	private shouldInterceptLink(url: string): boolean {
		if (!this.settings.matchUrl) return false;
		if (!this.isValidHttpUrl(url)) return false;
		const normalizedUrl = this.normalizeUrl(url);
		const normalizedMatchUrl = this.normalizeUrl(this.settings.matchUrl);
		return normalizedUrl.startsWith(normalizedMatchUrl);
	}

	private normalizeUrl(url: string): string {
		try {
			let normalized = url.toLowerCase().trim();
			if (normalized.endsWith('/') && normalized.length > 8) {
				normalized = normalized.slice(0, -1);
			}
			return normalized;
		} catch (error) {
			return url.toLowerCase().trim();
		}
	}

	private isValidHttpUrl(url: string): boolean {
		if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	}

	private interceptObsidianRequests() {
		const originalFetch = window.fetch;
		window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			let url: string;
			if (typeof input === 'string') url = input;
			else if (input instanceof URL) url = input.toString();
			else url = (input as Request).url;
			
			if (url && this.shouldInterceptLink(url)) {
				const authenticatedUrl = await this.processUrl(url);
				if (typeof input === 'string' || input instanceof URL) input = new URL(authenticatedUrl);
				else input = new Request(authenticatedUrl, input);
			}
			return originalFetch.call(window, input, init);
		};
		
		const originalXHROpen = XMLHttpRequest.prototype.open;
		const self = this;
		XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async: boolean = true, user?: string | null, password?: string | null) {
			let urlString = url.toString();
			if (urlString && self.shouldInterceptLink(urlString)) {
				self.processUrl(urlString).then(authenticatedUrl => {
					originalXHROpen.call(this, method, authenticatedUrl, async, user, password);
				}).catch(error => {
					console.error("Error processing URL for XHR:", error);
					originalXHROpen.call(this, method, urlString, async, user, password);
				});
			} else {
				originalXHROpen.call(this, method, urlString, async, user, password);
			}
		};
	}

	private setupMutationObserver() {
		const observer = new MutationObserver((mutations) => {
			if (!this.settings.matchUrl) return;
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node.nodeType === Node.ELEMENT_NODE) {
						const element = node as Element;
						this.processElementForAuth(element);
						element.querySelectorAll('img[src], video[src], audio[src], source[src], iframe[src], a[href]').forEach((mediaElement) => {
							this.processElementForAuth(mediaElement);
						});
					}
				});
			});
		});
		observer.observe(document.body, { childList: true, subtree: true });
		this.register(() => observer.disconnect());
	}

	private async processElementForAuth(element: Element) {
		const mediaTypes = [
			{ attribute: 'href', type: 'Link' },
			{ attribute: 'src', type: 'Media' }
		];
		for (const { attribute } of mediaTypes) {
			const originalUrl = element.getAttribute(attribute);
			if (!originalUrl || originalUrl.startsWith('app://') || originalUrl.startsWith('obsidian://') || originalUrl.startsWith('data:') || element.hasAttribute('data-auth-processed')) {
				continue;
			}
			if (this.shouldInterceptLink(originalUrl)) {
				const authenticatedUrl = await this.processUrl(originalUrl);
				element.setAttribute(attribute, authenticatedUrl);
				element.setAttribute('data-auth-processed', 'true');
				if (attribute === 'href' && element.tagName.toLowerCase() === 'a') {
					this.addClickInterceptor(element as HTMLAnchorElement, originalUrl);
				}
				(element as HTMLElement).title = `URL secured by S3 SecureFetch.\nOriginal: ${originalUrl}\nModified: ${authenticatedUrl}`;
				break;
			}
		}
	}

	private setupWorkspaceEventHandlers() {
		// URL-Menu Handler für Kontextmenüs
		this.registerEvent(
			this.app.workspace.on('url-menu', (menu, url) => {
				if (this.shouldInterceptLink(url)) {
					new Notice(`🔍 S3 Link erkannt im Kontextmenü: ${url}`);
					menu.addItem((item) => {
						item.setTitle('🔐 Open with S3 SecureFetch').setIcon('link').onClick(async () => {
							const authenticatedUrl = await this.processUrl(url);
							new Notice(`🔒 S3 Authentication successful`);
							window.open(authenticatedUrl, '_blank');
						});
					});
				}
			})
		);

		// Globaler Click Handler als Backup
		this.registerDomEvent(document, 'click', async (event) => {
			const linkElement = (event.target as HTMLElement).closest('a');
			if (linkElement) {
				const originalUrl = linkElement.getAttribute('data-original-url') || 
								   linkElement.getAttribute('href') || 
								   linkElement.getAttribute('data-href');
				
				if (originalUrl && this.shouldInterceptLink(originalUrl)) {
					console.log('🔍 S3 Link Click abgefangen:', originalUrl);
					new Notice(`🔍 S3 Link erkannt: ${originalUrl.substring(0, 50)}...`);
					
					event.preventDefault();
					event.stopPropagation();
					
					const authenticatedUrl = await this.processUrl(originalUrl);
					new Notice(`🔒 S3 Authentication successful`);
					window.open(authenticatedUrl, '_blank');
				}
			}
		}, true);

		// Zusätzlicher Handler für Obsidian-spezifische Link-Events
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				// Wird ausgelöst wenn eine Datei geöffnet wird
				if (file && file.path) {
					console.log('🔍 File-open Event:', file.path);
				}
			})
		);

		// Handler für URL-Öffnungen über Obsidian
		this.app.workspace.on('url-menu', (menu, url) => {
			if (this.shouldInterceptLink(url)) {
				console.log('🔍 URL-Menu Event für S3 Link:', url);
			}
		});

		// Interceptor für window.open Aufrufe
		this.originalWindowOpen = window.open;
		window.open = (url?: string | URL, target?: string, features?: string) => {
			if (url) {
				const urlString = url.toString();
				if (this.shouldInterceptLink(urlString)) {
					console.log('🔍 window.open abgefangen für S3 Link:', urlString);
					
					// Generiere signierte URL und öffne diese stattdessen
					this.processUrl(urlString).then(authenticatedUrl => {
						new Notice(`🔒 S3 Authentication successful`);
						console.log('🔐 Öffne signierte URL:', authenticatedUrl);
						this.originalWindowOpen.call(window, authenticatedUrl, target, features);
					}).catch(error => {
						console.error('Fehler beim Verarbeiten der URL:', error);
						this.originalWindowOpen.call(window, urlString, target, features);
					});
					return null; // Verhindere die ursprüngliche Öffnung
				}
			}
			return this.originalWindowOpen.call(window, url, target, features);
		};

		// Handler für externe Link-Öffnungen
		this.registerDomEvent(window, 'beforeunload', () => {
			// Cleanup vor dem Schließen
		});
	}

	private async processUrl(url: string): Promise<string> {
		if (this.settings.useSignedUrl) {
			return this.generateSignedS3Url(url);
		} else {
			return this.addAuthParam(url);
		}
	}

	private addAuthParam(url: string): string {
		try {
			const urlObj = new URL(url);
			urlObj.searchParams.set(this.settings.paramKey, this.settings.paramValue);
			return urlObj.toString();
		} catch (error) {
			console.error('Error adding auth parameter to URL:', error);
			return url;
		}
	}

	private async generateSignedS3Url(url: string): Promise<string> {
		const { s3AccessKeyId, s3SecretAccessKey, s3Region, s3Endpoint, s3Bucket } = this.settings;
		if (!s3AccessKeyId || !s3SecretAccessKey || !s3Region || !s3Bucket) {
			new Notice('❌ S3 settings are incomplete.');
			return url;
		}
		try {
			const urlObj = new URL(url);
			let key = urlObj.pathname;
			if (key.startsWith('/')) key = key.substring(1);
			const bucketPrefix = `${s3Bucket}/`;
			if (key.startsWith(bucketPrefix)) key = key.substring(bucketPrefix.length);

			const s3Client = new S3Client({
				region: s3Region,
				endpoint: s3Endpoint || undefined,
				credentials: { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey },
				forcePathStyle: !!s3Endpoint,
			});
			const command = new GetObjectCommand({ Bucket: s3Bucket, Key: key });
			return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
		} catch (error) {
			console.error('Error generating signed S3 URL:', error);
			new Notice('❌ Error generating signed S3 URL. Check console.');
			return url;
		}
	}
}

class S3SecureFetchSettingTab extends PluginSettingTab {
	plugin: S3SecureFetchPlugin;

	constructor(app: App, plugin: S3SecureFetchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'S3 SecureFetch Settings' });

		new Setting(containerEl)
			.setName('Match URL Pattern')
			.setDesc('URLs starting with this pattern will be processed (e.g., https://my-s3.storage.com)')
			.addText(text => text
				.setPlaceholder('https://example.com')
				.setValue(this.plugin.settings.matchUrl)
				.onChange(async (value) => {
					this.plugin.settings.matchUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Use S3 Pre-signed URL')
			.setDesc('Enable to generate a secure pre-signed URL. Disable for simple parameter authentication.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useSignedUrl)
				.onChange(async (value) => {
					this.plugin.settings.useSignedUrl = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.useSignedUrl) {
			containerEl.createEl('h3', { text: 'S3 Pre-signed URL Settings' });
			new Setting(containerEl).setName('S3 Bucket Name').setDesc('The name of your S3 bucket.').addText(text => text.setPlaceholder('my-bucket').setValue(this.plugin.settings.s3Bucket).onChange(async (value) => { this.plugin.settings.s3Bucket = value.trim(); await this.plugin.saveSettings(); }));
			new Setting(containerEl).setName('S3 Access Key ID').addText(text => text.setPlaceholder('Your S3 Access Key ID').setValue(this.plugin.settings.s3AccessKeyId).onChange(async (value) => { this.plugin.settings.s3AccessKeyId = value.trim(); await this.plugin.saveSettings(); }));
			new Setting(containerEl).setName('S3 Secret Access Key').addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('Your S3 Secret Access Key').setValue(this.plugin.settings.s3SecretAccessKey).onChange(async (value) => { this.plugin.settings.s3SecretAccessKey = value; await this.plugin.saveSettings(); }); });
			new Setting(containerEl).setName('S3 Region').setDesc('The AWS region of your bucket (e.g., us-east-1).').addText(text => text.setPlaceholder('us-east-1').setValue(this.plugin.settings.s3Region).onChange(async (value) => { this.plugin.settings.s3Region = value.trim(); await this.plugin.saveSettings(); }));
			new Setting(containerEl).setName('S3 Endpoint (Optional)').setDesc('For S3-compatible services like MinIO. Leave empty for AWS S3.').addText(text => text.setPlaceholder('https://minio.example.com').setValue(this.plugin.settings.s3Endpoint).onChange(async (value) => { this.plugin.settings.s3Endpoint = value.trim(); await this.plugin.saveSettings(); }));
		} else {
			containerEl.createEl('h3', { text: 'Simple Parameter Settings' });
			new Setting(containerEl).setName('Parameter Key').setDesc('Name of the URL parameter for authentication.').addText(text => text.setPlaceholder('key').setValue(this.plugin.settings.paramKey).onChange(async (value) => { this.plugin.settings.paramKey = value.trim(); await this.plugin.saveSettings(); }));
			new Setting(containerEl).setName('Parameter Value').setDesc('Value of the authentication parameter.').addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('your-auth-token').setValue(this.plugin.settings.paramValue).onChange(async (value) => { this.plugin.settings.paramValue = value; await this.plugin.saveSettings(); }); });
		}
	}
}
