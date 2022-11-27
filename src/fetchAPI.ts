/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as fetchH2 from 'fetch-h2';
import * as userLogin from "./userLogin";
import * as usageStats from "./usageStats";


let globalSeq = 100;


export class ApiFields {
    scope: string = "";
    url: string = "";
    model: string = "";
    sources: { [key: string]: string } = {};
    results: { [key: string]: string } = {};
    intent: string = "";
    function: string = "";
    cursor_file: string = "";
    cursor0: number = 0;
    cursor1: number = 0;
}


export class PendingRequest {
    seq: number;
    apiPromise: Promise<any> | undefined;
    cancelToken: vscode.CancellationToken;
    cancellationTokenSource: vscode.CancellationTokenSource | undefined;

    constructor(apiPromise: Promise<any> | undefined, cancelToken: vscode.CancellationToken)
    {
        this.seq = globalSeq++;
        this.apiPromise = apiPromise;
        this.cancelToken = cancelToken;
    }

    supply_stream(h2stream: Promise<fetchH2.Response>, api_fields: ApiFields)
    {
        h2stream.catch((error) => {
            if (!error.message.includes("aborted")) {
                global.menu.statusbarSocketError(true, `h2stream error(1): ${error}`);
                // usageStats.report_success(false, "h2stream (1)", error);
            } else {
                // Totally normal, user cancelled the request.
            }
            return;
        });
        this.apiPromise = new Promise((resolve, reject) => {
            h2stream.then((result_stream) => {
                let json = result_stream.json();
                json.then((result) => {
                    global.menu.statusbarSocketError(false);
                    resolve(result);
                }).catch((error) => {
                    // this happens!
                    console.log(["JSON ERROR", this.seq, error]);
                    global.menu.statusbarSocketError(true, `h2stream error(2): ${error}`);
                    reject(error);
                });
            }).catch((error) => {
                if (!error.message.includes("aborted")) {
                    console.log(["STREAM ERROR", this.seq, error]);
                    global.menu.statusbarSocketError(true, `h2stream error(3): ${error}`);
                }
                reject(error);
            });
        }).finally(() => {
            let index = globalRequests.indexOf(this);
            if (index >= 0) {
                globalRequests.splice(index, 1);
            }
            if (globalRequests.length === 0) {
                global.menu.statusbarLoading(false);
            }
            // console.log(["--pendingRequests", globalRequests.length, request.seq]);
        }).catch((error) => {
            if (!error.message.includes("aborted")) {
                global.menu.statusbarSocketError(true, `h2stream error(4): ${error}`);
            }
        });
        globalRequests.push(this);
        global.menu.statusbarLoading(true);
        // console.log(["++pendingRequests", globalRequests.length, request.seq]);
    }
}


let globalRequests: PendingRequest[] = [];


export async function waitAllRequests()
{
    for (let i=0; i<globalRequests.length; i++) {
        let r = globalRequests[i];
        if (r.apiPromise !== undefined) {
            let tmp = await r.apiPromise;
            console.log([r.seq, "wwwwwwwwwwwwwwwww", tmp]);
        }
    }
}

export function anything_still_working()
{
    for (let i=0; i<globalRequests.length; i++) {
        let r = globalRequests[i];
        if (!r.cancelToken.isCancellationRequested) {
            return true;
        }
    }
    return false;
}

export async function cancelAllRequests()
{
    for (let i=0; i<globalRequests.length; i++) {
        let r = globalRequests[i];
        if (r.cancellationTokenSource !== undefined) {
            r.cancellationTokenSource.cancel();
        }
    }
    await waitAllRequests();
}


export function fetch_api_promise(
    cancelToken: vscode.CancellationToken,
    sources: { [key: string]: string },
    intent: string,
    functionName: string,
    cursorFile: string,
    cursor0: number,
    cursor1: number,
    maxTokens: number,
    maxEdits: number,
    stop_tokens: string[],
): [Promise<fetchH2.Response>, ApiFields]
{
    let url_ = vscode.workspace.getConfiguration().get('codify.infurl');
    let url: string;
    if(typeof url_ !== 'string' || url_ === '') {
        url = "https://inference.smallcloud.ai/v1/contrast";
    } else {
        url = `${url_}`;
    }
    let model_ = vscode.workspace.getConfiguration().get('codify.model');
    let model: string;
    if (typeof model_ !== 'string' || model_ === '') {
        model = 'CONTRASTcode/stable';
    } else {
        model = `${model_}`;
    }
    let temp = vscode.workspace.getConfiguration().get('codify.temperature');
    let client_version = vscode.extensions.getExtension("smallcloud.codify")!.packageJSON.version;
    let api_fields = new ApiFields();
    api_fields.url = url;
    api_fields.model = model;
    api_fields.sources = sources;
    api_fields.intent = intent;
    api_fields.function = functionName;
    api_fields.cursor_file = cursorFile;
    api_fields.cursor0 = cursor0;
    api_fields.cursor1 = cursor1;
    const body = JSON.stringify({
        "model": model,
        "sources": sources,
        "intent": intent,
        "function": functionName,
        "cursor_file": cursorFile,
        "cursor0": cursor0,
        "cursor1": cursor1,
        "temperature": temp,
        "max_tokens": maxTokens,
        "max_edits": maxEdits,
        "stop": stop_tokens,
        "client": `vscode-${client_version}`,
    });
    const apiKey = userLogin.getApiKey();
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };
    let req = new fetchH2.Request(url, {
        method: "POST",
        headers: headers,
        body: body,
        redirect: "follow",
        cache: "no-cache",
        referrer: "no-referrer",
    });
    let init: any = {
    };
    if (cancelToken) {
        let abort = new fetchH2.AbortController();
        cancelToken.onCancellationRequested(() => {
            console.log(["API fetch cancelled"]);
            abort.abort();
        });
        init.signal = abort.signal;
    }
    let promise = fetchH2.fetch(req, init);
    return [promise, api_fields];
}


export function look_for_common_errors(json: any, scope: string): boolean
{
    if (json === undefined) {
        // undefined means error is already handled, do nothing
        return true;
    }
    if (json.detail) {
        global.menu.statusbarSocketError(true, `${scope}: ${json.detail}`);
        return true;
    }
    if (json.retcode && json.retcode !== "OK") {
        global.menu.statusbarSocketError(true, `${scope}: ${json.human_readable_message}`);
        return true;
    }
    if (json.error) {
        global.menu.statusbarSocketError(true, `${scope}: ${json.error.message}`);
        return true;
    }
    return false;
}


export async function report_to_mothership(
    positive: boolean,
    sources: { [key: string]: string },
    results: { [key: string]: string },
    intent: string,
    functionName: string,
    cursor_file: string,
    cursor_pos0: number,
    cursor_pos1: number,
    arrived_ts: number,
) {
    if (sources[cursor_file] === undefined || results[cursor_file] === undefined || sources[cursor_file] === results[cursor_file]) {
        return;
    }
    const url = "https://www.smallcloud.ai/v1/report-to-mothership";
    const body = JSON.stringify({
        "positive": positive,
        "sources": sources,
        "results": results,
        "intent": intent,
        "function": functionName,
        "cursor_file": cursor_file,
        "cursor0": cursor_pos0,
        "cursor1": cursor_pos1,
        "ponder_time_ms": Math.round(Date.now() - arrived_ts),
    });
    global.modelFunction = functionName;
    const apiKey = userLogin.getApiKey();
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };
    let req = new fetchH2.Request(url, {
        method: "POST",
        headers: headers,
        body: body,
        redirect: "follow",
        cache: "no-cache",
        referrer: "no-referrer",
    });
    let promise = fetchH2.fetch(req);
    promise.then((result) => {
        console.log([positive ? "👍" : "👎", "report_to_mothership", result.status]);
    }).catch((error) => {
        console.log(["report_to_mothership", "error", error]);
    });
    return promise;
}
