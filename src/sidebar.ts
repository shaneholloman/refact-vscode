/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as userLogin from "./userLogin";
import * as chatTab from './chatTab';
import * as statisticTab from './statisticTab';
import * as fimDebug from './fimDebug';
import { get_caps } from "./fetchAPI";
import ChatHistoryProvider, {convert_old_chat_to_new_chat} from "./chatHistory";
import type { OldChat } from "./chatHistory";
import { v4 as uuidv4 } from "uuid";
import { getKeyBindingForChat } from "./getKeybindings";
import {
    type ChatMessages,
    fim,
    isLogOut,
    isOpenExternalUrl,
    // type FileInfo,
    // setFileInfo,
    // type Snippet,
    // setSelectedSnippet,
    updateConfig,
    isSetupHost,
    type FileInfo,
    setFileInfo,
    type Snippet,
    setSelectedSnippet,
    type InitialState,
    newChatAction,
    ideOpenHotKeys,
    ideOpenFile,
    ideNewFileAction,
    ideOpenSettingsAction,
    ideDiffPasteBackAction,
    ChatThread,
} from "refact-chat-js/dist/events";
import { basename, join } from "path";
import { diff_paste_back } from "./chatTab";
import { execFile } from "child_process";


type Handler = ((data: any) => void) | undefined;
function composeHandlers(...eventHandlers: Handler[]) {
    return (data: any) => eventHandlers.forEach(fn => fn && fn(data));
}

export async function open_chat_tab(
    question: string,
    editor: vscode.TextEditor | undefined,
    attach_default: boolean,   // checkbox set on start, means attach the current file
    model: string,
    messages: ChatMessages,
    chat_id: string,
    append_snippet_to_input: boolean = false,
): Promise<chatTab.ChatTab|undefined> {
    if (global.side_panel?.chat) {
        global.side_panel.chat = null;
    }

    if (global.side_panel && global.side_panel._view) {
        const chat: ChatThread =  {
            id: uuidv4(),
            messages: question ? [
                ...messages,
                {role: "user", content: question},
            ] : [],
            model: model,
        };
        global.side_panel.goto_chat(chat);  // changes html

    }
    return;
}

export async function open_statistic_tab(): Promise<statisticTab.StatisticTab|undefined> {
    if (global.side_panel && global.side_panel._view) {
        let stat = global.side_panel.new_statistic(global.side_panel._view);

        let context: vscode.ExtensionContext | undefined = global.global_context;
        if (!context) {
            return;
        }
        global.side_panel.goto_statistic(stat);  // changes html
    }
    return;
}

export async function open_fim_debug(): Promise<void> {
    if (global.side_panel && global.side_panel._view) {
        let fim = global.side_panel.new_fim_debug(global.side_panel._view);

        let context: vscode.ExtensionContext | undefined = global.global_context;
        if (!context) {
            return;
        }

        global.side_panel.goto_fim(fim);
    }
    return;
}

export class PanelWebview implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _history: string[] = [];
    selected_lines_count: number = 0;
    access_level: number = -1;
    cancel_token: vscode.CancellationToken | undefined = undefined;
    public address: string;

    public chat: chatTab.ChatTab | null = null;
    public statistic: statisticTab.StatisticTab | null = null;
    public fim_debug: fimDebug.FimDebug | null = null;
    public chatHistoryProvider: ChatHistoryProvider|undefined;

    _disposables: vscode.Disposable[] = [];

    public static readonly viewType = "refactai-toolbox";

    constructor(private readonly context: vscode.ExtensionContext) {
        this.chatHistoryProvider = undefined;
        this.address = "";
        this.js2ts_message = this.js2ts_message.bind(this);

        this.handleEvents = this.handleEvents.bind(this);

        this._disposables.push(vscode.window.onDidChangeActiveTextEditor(() => {
            this.postActiveFileInfo();
            this.sendSnippetToChat();
          }));

        this._disposables.push(vscode.window.onDidChangeTextEditorSelection(() => {
           this.postActiveFileInfo();
           this.sendSnippetToChat();
        }));

        this._disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
            if(event.affectsConfiguration("refactai.vecdb") || event.affectsConfiguration("refactai.ast")) {
                this.handleSettingsChange();
            }
        }));

        // TODO: theme changes.
    }

    // handleEvents(data: any) {
    //     if(!this._view) { return; }
    //     return composeHandlers(this.chat?.handleEvents, this.js2ts_message)(data);
    // }

    sendSnippetToChat() {
        const snippet = this.getSnippetFromEditor();
        if(!snippet) { return; }
        const message = setSelectedSnippet(snippet);
        this._view?.webview.postMessage(message);
    }

    trimIndent(code: string) {
        if(/^\s/.test(code) === false) { return code; }
        const lastLine = code.split("\n").slice(-1)[0];
        if(/^\s/.test(lastLine) === false) { return code; }
        const tabSettings = vscode.workspace.getConfiguration("editor").get<number>("tabSize") ?? 4;
        const spaces = " ".repeat(tabSettings);
        const spacedCode = code.replace(/^\t+/gm, (match) => {
            return match.replace(/\t/g, spaces);
        });
        const regexp = new RegExp(`^${spaces}`, "gm");
        const indented = spacedCode.replace(regexp, "");
        return indented;
    }

    getSnippetFromEditor(): Snippet {
        // if(!this.working_on_snippet_code) { return; }
        const language = vscode.window.activeTextEditor?.document.languageId ?? "";
        const isEmpty = vscode.window.activeTextEditor?.selection.isEmpty ?? true;
        const selection = vscode.window.activeTextEditor?.selection;
        const code = isEmpty ? "" : vscode.window.activeTextEditor?.document.getText(selection) ?? "";
        const filePath = vscode.window.activeTextEditor?.document.fileName?? "";
        const fileName = basename(filePath);


        const indentedCode = this.trimIndent(code);

        return {
            code: indentedCode,
            language,
            path: filePath,
            basename: fileName
        };
    }

    postActiveFileInfo() {
        const file = this.getActiveFileInfo();
        if(file === null) {
            const message = setFileInfo({  name: "",
                line1: null,
                line2: null,
                can_paste: false,
                path: "",
                cursor: null
            });
            this._view?.webview.postMessage(message);
        } else {
            const message = setFileInfo(file);
            this._view?.webview.postMessage(message);
        }
    }

    getActiveFileInfo(): FileInfo | null {
        if(vscode.window.activeTextEditor?.document.uri.scheme !== "file") {
            return null;
        }
        const file_path =
			vscode.window.activeTextEditor?.document.fileName || "";
        const file_name = basename(file_path);
        const file_content = vscode.window.activeTextEditor?.document.getText() || "";
        const start = vscode.window.activeTextEditor?.selection.start;
        const end = vscode.window.activeTextEditor?.selection.end;
        const lineCount = vscode.window.activeTextEditor?.document.lineCount ?? 0;
        const cursor = vscode.window.activeTextEditor?.selection.active.line ?? null;
        const can_paste = vscode.window.activeTextEditor?.document.uri.scheme === "file";

        const maybeLineInfo = start !== undefined && end !== undefined && !start.isEqual(end)
            ? { line1: start.line + 1, line2: end.line + 1 }
            : { line1:  1, line2: lineCount + 1 };

        const file = {
            name: file_name,
            content: file_content,
            path: file_path,
            usefulness: 100,
            cursor,
            can_paste,
            ...maybeLineInfo,
        };

        return file;
    }

    handleSettingsChange() {
        const vecdb =
            vscode.workspace
                .getConfiguration()
                ?.get<boolean>("refactai.vecdb") ?? false;

        const ast =
            vscode.workspace
                .getConfiguration()
                ?.get<boolean>("refactai.ast") ?? false;


        const apiKey = vscode.workspace.getConfiguration()?.get<string>("refactai.apiKey") ?? "";
        const addressURL = vscode.workspace.getConfiguration()?.get<string>("refactai.addressURL") ?? "";
        const port = global.rust_binary_blob?.get_port() ?? 8001;

        const message = updateConfig({
            apiKey,
            addressURL,
            lspPort: port,
            features: {vecdb, ast}
        });

        this._view?.webview.postMessage(message);
    }

    // This can go
    public make_sure_have_chat_history_provider()
    {
        if (!this.chatHistoryProvider) {
            this.chatHistoryProvider = new ChatHistoryProvider(
                this.context,
            );
        }
        return this.chatHistoryProvider;
    }

    // This can be deleted
    public new_chat(view: vscode.WebviewView, chat_id: string)
    {
        if (chat_id === "" || chat_id === undefined) {
            chat_id = uuidv4();
        }
        this.chat = new chatTab.ChatTab(view, this.make_sure_have_chat_history_provider(), chat_id);
        this.address = chat_id;
        return this.chat;
    }

    public new_statistic(view: vscode.WebviewView)
    {
        this.statistic = new statisticTab.StatisticTab(view);
        return this.statistic;
    }

    public new_fim_debug(view: vscode.WebviewView) {
        this.fim_debug = new fimDebug.FimDebug(view);
        return this.fim_debug;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        cancel_token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        this.cancel_token = cancel_token;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.update_webview();
            }
        });

        this.goto_main();

        vscode.commands.registerCommand('workbench.action.focusSideBar', () => {
            webviewView.webview.postMessage({ command: "focus" });
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            this.handleEvents(data);
        });
    }

    public async goto_main()
    {
        this.address = "";
        if (!this._view) {
            return;
        }
        this._view.webview.html = await this.html_main_screen(this._view.webview);
        this.update_webview();
    }

    // can change this to
    public async goto_chat(chat_thread?: ChatThread)
    {

        // this.html_main_screen(this._view.webview);
        // this.address = chat.chat_id;
        if (!this._view) {
            return;
        }
        // this._view.webview.html = chat.get_html_for_chat(
        //     this._view.webview,
        //     this.context.extensionUri
        // );

        // Could throw?
        const html = await this.html_main_screen(this._view.webview, chat_thread);
        this._view.webview.html = html;
        // this.update_webview();
    }

    public async newChat()
    {
        const message = newChatAction();
        this._view?.webview.postMessage(message);
    }

    public goto_statistic(statistic: statisticTab.StatisticTab)
    {
        if (!this._view) {
            return;
        }
        this._view.webview.html = statistic.get_html_for_statistic(
            this._view.webview,
            this.context.extensionUri,
        );
        this.update_webview();
    }

    public goto_fim(fim: fimDebug.FimDebug) {
        if (!this._view) { return; }
        this._view.webview.html = fim.get_html(
            this._view.webview,
            this.context.extensionUri
        );
        this.update_webview();
    }

    public update_chat_history()
    {
        const history = this.make_sure_have_chat_history_provider().chats_sorted_by_time();
        if (this._view) {
            this._view.webview.postMessage({
                command: "loadHistory",
                history: history,
            });
        }
    }

    public async delete_old_settings()
    {
        await vscode.workspace.getConfiguration().update('refactai.apiKey', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update('refactai.addressURL', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update('codify.apiKey', undefined, vscode.ConfigurationTarget.Global);
        if(vscode.workspace.workspaceFolders) {
            await vscode.workspace.getConfiguration().update('refactai.apiKey', undefined, vscode.ConfigurationTarget.Workspace);
            await vscode.workspace.getConfiguration().update('refactai.addressURL', undefined, vscode.ConfigurationTarget.Workspace);
            await vscode.workspace.getConfiguration().update('codify.apiKey', undefined, vscode.ConfigurationTarget.Workspace);
        }
    }

    public async js2ts_message(data: any)
    {
        if (!this._view) {
            return;
        }
        // console.log(`RECEIVED JS2TS: ${JSON.stringify(data)}`);
        switch (data.type) {
        // case EVENT_NAMES_FROM_CHAT.OPEN_IN_CHAT_IN_TAB:
        case "open_chat_in_new_tab": {
            const chat_id = data?.chat_id || this.chat?.chat_id;
            // const chat_id = data.payload.id;
            if(!chat_id || typeof chat_id !== "string") {return; }
            if(!this.chatHistoryProvider) { return; }

            const openTab = global.open_chat_tabs?.find(tab => tab.chat_id === chat_id);
            if(openTab) {
                return openTab.focus();
            }
            // is extensionUri defined anywhere?
            await chatTab.ChatTab.open_chat_in_new_tab(this.chatHistoryProvider, chat_id, this.context.extensionUri.toString(), true);
            this.chat = null;
            return this.goto_main();
        }
        case "focus_back_to_editor": {
            vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            break;
        }

        case "open_new_chat": {
            let question = data.question;
            if (!question) {
                question = "";
            }
            let editor = vscode.window.activeTextEditor;
            let attach_default = !!vscode.window.activeTextEditor;
            await open_chat_tab(
                question,
                editor,
                attach_default,
                data.chat_model,
                [],      // messages
                "",      // chat id
                true,
            );
            break;
        }
        case "open_statistic": {
            await open_statistic_tab();
            break;
        }
        case "delete_chat": {
            const chat_id = data.chat_id;
            await this.make_sure_have_chat_history_provider().delete_chat(chat_id);
            break;
        }
        case "button_hf_open_tokens": {
            vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/settings/tokens`));
            break;
        }
        case "privacy": {
            vscode.commands.executeCommand("refactaicmd.privacySettings");
            break;
        }
        case "js2ts_report_bug": {
            vscode.env.openExternal(vscode.Uri.parse(`https://github.com/smallcloudai/refact-vscode/issues`));
            break;
        }
        case "js2ts_discord": {
            vscode.env.openExternal(vscode.Uri.parse(`https://www.smallcloud.ai/discord`));
            break;
        }
        case "js2ts_logout": {
            vscode.commands.executeCommand("refactaicmd.logout");
            break;
        }
        case "js2ts_goto_profile": {
            vscode.env.openExternal(vscode.Uri.parse(`https://refact.smallcloud.ai/account?utm_source=plugin&utm_medium=vscode&utm_campaign=account`));
            break;
        }
        case "js2ts_refresh_login": {
            userLogin.inference_login_force_retry();
            await userLogin.inference_login();
            break;
        }
        case "openSettings": {
            vscode.commands.executeCommand("refactaicmd.openSettings");
            break;
        }
        case "openKeys": {
            vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "Refact.ai");
            break;
        }
        case "restore_chat": {
            const chat_id = data.chat_id;
            if (!chat_id) {
                break;
            }
            let editor = vscode.window.activeTextEditor;

            const caps = await get_caps();

            let chat: OldChat | undefined = await this.make_sure_have_chat_history_provider().lookup_chat(chat_id);
            if (!chat) {
                console.log(`Chat ${chat_id} not found, cannot restore`);
                break;
            }

            const openTab = global.open_chat_tabs?.find(tab => tab.chat_id === chat_id);
            if(openTab) {
                return openTab.focus();
            } else {
                const model = caps.running_models.includes(chat.chatModel)
					? chat.chatModel
					: caps.code_chat_default_model;

                // await open_chat_tab(
                //     "",
                //     editor,
                //     true,
                //     model,
                //     chat.messages,
                //     chat_id,
                // );
            }
            break;
        }
        case "save_telemetry_settings": {
            // await vscode.workspace.getConfiguration().update('refactai.telemetryCodeSnippets', data.code, vscode.ConfigurationTarget.Global);
            break;
        }
        // case EVENT_NAMES_FROM_CHAT.BACK_FROM_CHAT:
        // case EVENT_NAMES_FROM_STATISTIC.BACK_FROM_STATISTIC:
        // case FIM_EVENT_NAMES.BACK:
        case "back-from-chat": {
            this.goto_main();
            this.chat = null;
            break;
        }

        case "fim_debug": {
            await open_fim_debug();
            break;
        }
        }
    }

    public update_webview()
    {
        if (!this._view) {
            return;
        }
        let have_key = !!userLogin.secret_api_key() && !!userLogin.get_address();
        if (have_key) {
            this.update_chat_history();
        }
        let plan_msg = global.user_active_plan;
        if (!plan_msg && global.streamlined_login_countdown > -1) {
            plan_msg = `Waiting for website login... ${global.streamlined_login_countdown}`;
        } else if (plan_msg) {
            plan_msg = "Active Plan: <b>" + plan_msg + "</b>";
        }
        this._view!.webview.postMessage({
            command: "ts2js",
            ts2js_user: global.user_logged_in,
            ts2js_havekey: have_key,
            ts2js_apikey: global.api_key,
            ts2js_plan: plan_msg,
            ts2js_metering_balance: global.user_metering_balance,
            ts2js_staging: vscode.workspace.getConfiguration().get('refactai.staging'),
            ts2js_stat_info: "stat inforamtion"
        });
    }

    private async handleEvents(e: unknown) {
        console.log("sidebar event", e);
        if(!e || typeof e !== "object") {
            return;
        }
        if(!("type" in e)) {
            return;
        }
        // FIM Data from IDE
        if(fim.ready.match(e)|| fim.request.match(e)) {
            if(global.fim_data_cache) {
                const event = fim.receive(global.fim_data_cache);
                this._view?.webview.postMessage(event);
            } else {
                const event = fim.error("No FIM data found, please make a completion");
                this._view?.webview.postMessage(event);
            }
        }

        if (isSetupHost(e)) {
            const { host } = e.payload;
            if (host.type === "cloud") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.telemetryCodeSnippets', host.sendCorrectedCodeSnippets, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.addressURL', "Refact", vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', host.apiKey, vscode.ConfigurationTarget.Global);
            } else if (host.type === "self") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.addressURL', host.endpointAddress, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', 'any-will-work-for-local-server', vscode.ConfigurationTarget.Global);
            } else if (host.type === "enterprise") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.addressURL', host.endpointAddress, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', host.apiKey, vscode.ConfigurationTarget.Global);
            } else if (host.type === "bring-your-own-key") {
                if (global.rust_binary_blob === undefined) {
                    console.error("no rust binary blob");
                    return;
                }
                let command: string[] = [
                    join(global.rust_binary_blob.asset_path, "refact-lsp"),
                    "--save-byok-file",
                    "--address-url", "xxx",
                ];
                execFile(command[0], command.splice(1), async (err, stdout, stderr) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    const path = stdout.trim();
                    vscode.workspace.openTextDocument(path).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                    await vscode.workspace.getConfiguration().update('refactai.addressURL', path, vscode.ConfigurationTarget.Global);
                    await vscode.workspace.getConfiguration().update('refactai.apiKey', 'any-will-work-for-local-server', vscode.ConfigurationTarget.Global);
                });
            }
        }

        if (isLogOut(e)) {
            await this.delete_old_settings();
        }

        if (isOpenExternalUrl(e)) {
            await vscode.env.openExternal(vscode.Uri.parse(e.payload.url));
        }


        if(ideNewFileAction.match(e)) {
            const action = e as ReturnType<typeof ideNewFileAction>
            return vscode.workspace.openTextDocument().then((document) => {
                vscode.window.showTextDocument(document, vscode.ViewColumn.Active)
                    .then((editor) => {
                        editor.edit((editBuilder) => {
                            editBuilder.insert(new vscode.Position(0, 0), action.payload);
                        });
                    });
            });
        }

        if(ideOpenHotKeys.match(e)) {
            return vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "refact.ai");
        }

        if(ideOpenSettingsAction.match(e)) {
            return vscode.commands.executeCommand("workbench.action.openSettings", "refactai");
        }

        if(ideOpenFile.match(e)) {
            return this.handleOpenFile(e.payload);
        }

        if(ideDiffPasteBackAction.match(e)) {
            return this.handleDiffPasteBack(e.payload);
        }

        // if(ideOpenChatInNewTab.match(e)) {
        //     return this.handleOpenInTab(e.payload);
        // }
    }

    // async handleOpenInTab(chat_thread: ChatThread) {
    //     if(!this._view) {
    //         // Can this._view be undefined?
    //         return;
    //     }

    //     const panel = vscode.window.createWebviewPanel(
    //         "refact-chat-tab",
    //         truncate(`Refact.ai ${chat_thread.title}`, 24),
    //         vscode.ViewColumn.One,
    //         {
    //             enableScripts: true,
    //             retainContextWhenHidden: true,
    //         }
    //     );

    //     // make the global tabs an object with chat id as the key.
    //     const html = await this.html_main_screen(this._view.webview, chat_thread, true);
    //     global.open_chat_panels[chat_thread.id] = panel;
    //     panel.onDidDispose(() => {
    //         delete global.open_chat_panels[chat_thread.id];
    //     });
    //     this.goto_main();
    //     panel.webview.html = html;

    // }

    private async handleDiffPasteBack(code_block: string) {
        const editor = vscode.window.activeTextEditor;
        if(!editor) { return; }
        const selection = editor.selection;
        const startOfLine = new vscode.Position(selection.start.line, 0);
        const endOfLine = new vscode.Position(selection.start.line + 1, 0);
        const firstLineRange = new vscode.Range(startOfLine, endOfLine);
        const spaceRegex = /^[ \t]+/;
        const selectedLine = editor.document.getText(
            firstLineRange
        );
        const indent = selectedLine.match(spaceRegex)?.[0] ?? "";
        const needsNewLine = code_block.endsWith("\n") === false;
        const indentedCode = (indent + code_block).replace(/\n/gm, "\n" + indent) + (needsNewLine ? "\n" : "");

        const range = new vscode.Range(startOfLine, selection.end);

		return diff_paste_back(
            editor,
            range,
            indentedCode
        );

	}

    async handleOpenFile(file: {file_name:string, line?: number}) {
        const uri = vscode.Uri.file(file.file_name);
        const document = await vscode.workspace.openTextDocument(uri);
        if(file.line !== undefined) {
            const position = new vscode.Position(file.line ?? 0, 0);
            const editor = await vscode.window.showTextDocument(document);
            const range = new vscode.Range(position, position);
            editor.revealRange(range);
        }
    }

    getColorTheme(): "light" | "dark" {
        switch(vscode.window.activeColorTheme.kind) {
            case vscode.ColorThemeKind.Light: return "light";
            case vscode.ColorThemeKind.HighContrastLight: return "light";
            default: return "dark";
        }
    }


    async createInitialState(thread?: ChatThread, tabbed = false): Promise<Partial<InitialState>> {
        const fontSize = vscode.workspace.getConfiguration().get<number>("editor.fontSize") ?? 12;
        const scaling = fontSize < 14 ? "90%" : "100%";
        const activeColorTheme = this.getColorTheme();
        const vecdb = vscode.workspace.getConfiguration()?.get<boolean>("refactai.vecdb") ?? false;
        const ast = vscode.workspace.getConfiguration()?.get<boolean>("refactai.ast") ?? false;
        const apiKey = vscode.workspace.getConfiguration()?.get<string>("refactai.apiKey") ?? "";
        const addressURL = vscode.workspace.getConfiguration()?.get<string>("refactai.addressURL") ?? "";
        const port = global.rust_binary_blob?.get_port() ?? 8001;
        const completeManual = await getKeyBindingForChat("refactaicmd.completionManual");
        const maybeHistory = this.context.globalState.get<OldChat[]>("refact_chat_history") ?? [];

        const config: InitialState["config"] = {
            host: "vscode",
            tabbed,
            themeProps: {
                accentColor: "gray",
                scaling,
                hasBackground: false,
                appearance: activeColorTheme,
            },
            features: {
                vecdb,
                ast,
            },
            keyBindings: {
                completeManual,
            },
            apiKey,
            addressURL,
            lspPort: port,
        };

        const state: Partial<InitialState> = {
            config,
        };

        const file = this.getActiveFileInfo();
        const snippet = this.getSnippetFromEditor();

        if(snippet && file) {
            state.active_file = file;
            state.selected_snippet = snippet;
        }
        if(maybeHistory.length > 0) {
            state.history =  maybeHistory.map(convert_old_chat_to_new_chat).reduce<InitialState["history"]>((acc, cur) => {
                return {
                    ...acc,
                    [cur.id]: cur
                };
            }, {});
            this.context.globalState.update("refact_chat_history", []);
        }

        if(thread) {
            const chat: InitialState["chat"] = {
                streaming: false,
                error: null,
                prevent_send: true,
                previous_message_length: thread.messages.length,
                waiting_for_response: false,
                tool_use: "agent",
                cache: {},
                system_prompt: {},
                send_immediately: thread.messages.length > 0,
                thread,
            };

            state.chat = chat;
            state.pages = [{name: "initial setup"}, {name: "history"}, {name: "chat"}];
        }

        return state;
    }

    private async html_main_screen(webview: vscode.Webview, chat_thread?: ChatThread, tabbed?: boolean)
    {
        // TODO: add send immediately flag for context menu and toolbar
        const extensionUri = this.context.extensionUri;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "node_modules", "refact-chat-js", "dist", "chat", "index.umd.cjs")
        );

        const styleMainUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "node_modules", "refact-chat-js", "dist", "chat", "style.css")
        );

        const styleOverride = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "assets", "custom-theme.css")
        );

        const nonce = this.getNonce();
        // if(vscode.workspace.getConfiguration().get('refactai.telemetryCodeSnippets')) {
        //     telemetry_code = 'checked';
        // }
        let existing_address = vscode.workspace.getConfiguration().get("refactai.addressURL");
        if (typeof existing_address !== "string" || (typeof existing_address === "string" && !existing_address.match(/^https?:\/\//))) {
            existing_address = "";
        }

        const initialState = await this.createInitialState(chat_thread, tabbed);

        return `<!DOCTYPE html>
            <html lang="en" class="light">
            <head>
                <meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading images from https or from our extension directory,
                    and only allow scripts that have a specific nonce.
                    TODO: remove  unsafe-inline if posable
                -->
                <meta http-equiv="Content-Security-Policy" content="style-src ${
                  webview.cspSource
                } 'unsafe-inline'; img-src 'self' data: https:; script-src 'nonce-${nonce}'; style-src-attr 'sha256-tQhKwS01F0Bsw/EwspVgMAqfidY8gpn/+DKLIxQ65hg=' 'unsafe-hashes';">
                <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1">

                <title>Refact.ai Chat</title>
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleOverride}" rel="stylesheet">
            </head>
            <body>
                <div id="refact-chat"></div>

                <script nonce="${nonce}">
                const initialState = ${JSON.stringify(initialState)};
                window.__INITIAL_STATE__ = initialState;
                window.onload = function() {
                    const root = document.getElementById("refact-chat");
                    // TODO: config no longer needs to passed to the component like this.np
                    RefactChat.render(root, initialState.config);
                }
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    getNonce() {
        let text = "";
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}


export default PanelWebview;