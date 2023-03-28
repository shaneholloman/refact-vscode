/* eslint-disable @typescript-eslint/naming-convention */
(function () {
    const vscode = acquireVsCodeApi();
    // let presets = document.querySelectorAll(".presets li");
    const body = document.querySelector("body");
    const sidebar = document.querySelector("#sidebar");
    const toolbox = document.querySelector(".toolbox");
    const toolboxSearch = document.querySelector("#toolbox-search");
    const toolboxList = document.querySelector(".toolbox-list");
    // const toolboxRun = document.querySelector(".toolbox-run");
    // let toolboxIndex = 0;
    let longthink_functions_today;
    let longthink_functions_json;
    let editor_inform_how_many_lines_selected = 0;
    let editor_inform_file_access_level = 0;
    let function_bookmarks = [];

    let history = [];
    let history_backup = "";
    let current_history = 0;
    let current_command = 0;
    let history_mode = false;
    let command_mode = false;

    function reset_everything_about_commands()
    {
        current_history = 0;
        command_mode = false;
        history_mode = false;
        let active = document.querySelector(".item-selected");
        if (active) {
            active.classList.remove("item-selected");
        }
    }

    toolboxSearch.addEventListener("focus", (event) => {
        on_how_many_lines_selected();
    });

    toolboxSearch.addEventListener("keyup", (event) => {
        event.preventDefault();
        if (event.target.value !== '') {
            if (document.querySelector('.item-active')) {
                document.querySelector('.item-active').classList.remove('item-active');
            }
        }
        if (event.key === "ArrowUp") {
            if (!command_mode && history_mode && current_history >= 0 && current_history < (history.length - 1)) {
                current_history++;
                toolboxSearch.value = history[current_history];
            }
            if (!command_mode && !history_mode) {
                history_backup = toolboxSearch.value;
                toolboxSearch.value = history[current_history];
                history_mode = true;
                current_history = 0;
            }
            if (command_mode && !history_mode && current_command === 0) {
                let active = document.querySelector(".item-selected");
                if (active) {
                    active.classList.remove("item-selected");
                }
                command_mode = false;
            }
            if (command_mode && !history_mode && current_command !== 0) {
                const toolboxItems = document.querySelectorAll(".toolbox-item");
                const all_visible = Array.from(toolboxItems).filter(child => {
                    return child.style.display !== 'none';
                });
                if (current_command > 0) {
                    all_visible[current_command].classList.remove('item-selected');
                    current_command -= 1;
                    all_visible[current_command].classList.add('item-selected');
                }
            }
        }
        if (event.key === "ArrowDown") {
            if (!command_mode && history_mode && current_history === 0) {
                current_history = 0;
                toolboxSearch.value = history_backup;
                history_mode = false;

            } else if (!command_mode && history_mode && current_history > 0) {
                current_history--;
                toolboxSearch.value = history[current_history];

            } else if (command_mode && !history_mode && current_command >= 0) {
                const toolbox_items = document.querySelectorAll(".toolbox-item");
                const all_visible = Array.from(toolbox_items).filter(child => {
                    return child.style.display !== 'none';
                });
                all_visible[current_command].classList.remove('item-selected');
                if (current_command < all_visible.length - 1) {
                    current_command += 1;
                }
                all_visible[current_command].classList.add('item-selected');

            } else if (!command_mode && !history_mode) {
                command_mode = true;
                const toolbox_items = document.querySelectorAll(".toolbox-item");
                const all_visible = Array.from(toolbox_items).filter(child => {
                    return child.style.display !== 'none';
                });
                current_command = 0;
                all_visible[current_command].classList.add('item-selected');
            }
        }
    });


    body.addEventListener("keyup", (event) => {
        event.preventDefault();
        if (event.key === "Enter") {
            let selected_in_list = document.querySelector(".item-selected");  // one in list, always present
            let single_page = document.querySelector(".item-active");  // single page
            if(toolboxSearch.value.endsWith("?")) {
                let intent = toolboxSearch.value;
                vscode.postMessage({ type: "open_new_chat", value: intent });
            }
            else if (single_page) {
                let intent = toolboxSearch.value;
                history.splice(0, 0, intent);
                vscode.postMessage({
                    type: "function_activated",
                    intent: intent,
                    data_function: active.dataset.function, // this a string containing json
                });
            } else if (selected_in_list) {
                let intent = toolboxSearch.value;
                history.splice(0, 0, intent);
                vscode.postMessage({
                    type: "function_activated",
                    intent: intent,
                    data_function: selected_in_list.dataset.function, // this a string containing json
                });
            } else {
                let intent = toolboxSearch.value;
                history.splice(0, 0, intent);
                let function_to_run = JSON.stringify(longthink_functions_today['hl-and-fix']);
                if(editor_inform_how_many_lines_selected > 0) {
                    function_to_run = JSON.stringify(longthink_functions_today['select-and-refactor']);
                }
                vscode.postMessage({
                    type: "function_activated",
                    intent: intent,
                    data_function: function_to_run, // this
                });
            }
            reset_everything_about_commands();
            toolboxSearch.value = '';
            vscode.postMessage({
                type: "focus_back_to_editor",
            });
            toolbox_update_likes();
        }
        if (event.key === "Escape") {
            event.preventDefault();
            let active = document.querySelector(".item-active");
            if (active) {
                active.classList.remove("item-active");
            } else {
                vscode.postMessage({
                    type: "focus_back_to_editor",
                });
            }
        }
    });

    toolboxList.addEventListener("click", (event) => {
        if (event.target.classList.contains("toolbox-run") && !event.target.classList.contains("toolbox-run-disabled")) {
            let intent = toolboxSearch.value;
            let target = event.target.parentElement.parentElement;
            if (!target) {
                return;
            }
            if(target.classList.contains('toolbox-body')) {
                target = target.parentElement;
            }
            history.splice(0, 0, intent);
            vscode.postMessage({
                type: "function_activated",
                intent: intent,
                data_function: target.dataset.function
            });
            vscode.postMessage({
                type: "focus_back_to_editor",
            });
        }
        if (event.target.classList.contains("toolbox-back")) {
            let active = document.querySelector(".item-active");
            document.querySelector(".item-active .toolbox-notice").classList.remove('toolbox-notice-hidden');
            if (active) {
                // toolboxSearch.value = '';
                active.classList.remove("item-active");
                toolbox_update_likes();
            }
        }
    });

    const chatButton = document.querySelector("#chat");
    chatButton.addEventListener("click", () => {
        vscode.postMessage({ type: "open_new_chat", value: '' });
    });

    const settingsButton = document.querySelector("#settings");
    settingsButton.addEventListener("click", () => {
        vscode.postMessage({ type: "openSettings" });
    });

    const reportBugsButton = document.querySelector("#report_bugs");
    reportBugsButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_report_bug" });
    });

    const profileButton = document.querySelector("#profile");
    profileButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_goto_profile" });
    });

    const dataButton = document.querySelector("#datacollection");
    dataButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_goto_datacollection" });
    });

    const logoutButton = document.querySelector("#logout");
    logoutButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_logout" });
    });

    const discordButton = document.querySelector("#discord");
    discordButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_discord" });
    });


    const loginButton = document.querySelector("#login");
    loginButton.addEventListener("click", () => {
        vscode.postMessage({ type: "login" });
    });

    const privacyButton = document.querySelector("#privacy");
    privacyButton.addEventListener("click", () => {
        vscode.postMessage({ type: "privacy" });
    });

    const refreshButton = document.querySelector(".sidebar-plan-button");
    refreshButton.addEventListener("click", () => {
        vscode.postMessage({ type: "js2ts_refresh_login" });
    });

    function check_bookmarked_functions(data) {
        const keys = Object.keys(data);
        keys.forEach((key) => {
            let bookmark = {};
            if (function_bookmarks[key]) {
                bookmark = {
                    ...data[key],
                    'is_bookmarked': true
                };
            }
            else {
                bookmark = {
                    ...data[key],
                    'is_bookmarked': false
                };
            }
            data[key] = bookmark;
        });
        return data;
    }

    // renderToolbox(data);
    function renderToolbox(data) {
        const bookmarked = check_bookmarked_functions(data);
        const sortedData = Object.entries(bookmarked)
            .sort(([, a], [, b]) => {
                if (a.is_bookmarked !== b.is_bookmarked) {
                    return a.is_bookmarked ? -1 : 1; // bookmarked
                } else if (a.catch_all_hl === 1 || a.catch_all_selection === 1) {
                    return 1; // move a to the bottom
                } else if (b.catch_all_hl === 1 || b.catch_all_selection === 1) {
                    return -1; // move b to the bottom
                } else {
                    return b.likes - a.likes; // likes
                }
            })
            .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
        const keys = Object.keys(sortedData);
        toolboxList.innerHTML = '';
        keys.forEach((key) => {
            let item = data[key];
            // render_function(data[key]);

            const toolbox_item = document.createElement("div");
            toolbox_item.classList.add("toolbox-item");
            if (item.catch_all_hl === 0 && item.catch_all_selection === 0 && item.catch_question_mark === 0) {
                toolbox_item.classList.add("toolbox-filter");
            }
            else {
                toolbox_item.classList.add("toolbox-static");
            }
            toolbox_item.id = key;
            toolbox_item.dataset.title = item.label;
            toolbox_item.dataset.function = JSON.stringify(item);
            toolbox_item.dataset.function_name = item.function_name;

            const header = document.createElement("div");
            header.classList.add("toolbox-header");
            const body = document.createElement("div");
            body.classList.add("toolbox-body");
            // likes
            const likes = document.createElement("div");
            likes.classList.add("toolbox-likes");
            const likes_span = document.createElement("span");
            const likes_icon = document.createElement("i");
            likes_span.innerHTML = item.likes;
            // bookmark
            const bookmark = document.createElement("div");
            bookmark.classList.add("toolbox-bookmark");
            const bookmark_icon = document.createElement("i");
            if (item.is_liked > 0) {
                likes_icon.classList.add("toolbox-like");
            } else {
                likes_icon.classList.add("toolbox-like-empty");
            }
            if (item.is_bookmarked) {
                bookmark_icon.classList.add("toolbox-mark");
            }

            // run
            const run = document.createElement("button");
            run.classList.add('toolbox-run');
            run.innerHTML = '▶';
            const run_clone = run.cloneNode(true);

            // back
            const contentActions = document.createElement("div");
            contentActions.classList.add('toolbox-content-actions');
            const backButton = document.createElement('button');
            backButton.classList.add('toolbox-back');
            backButton.innerText = '← Back';

            // content
            const content_title = document.createElement("h3");
            content_title.classList.add('toolbox-content-title');
            content_title.innerHTML = item.label;

            const content = document.createElement("div");
            const content_text = document.createElement("div");
            content.classList.add('toolbox-content');
            content.appendChild(content_title);
            content_text.innerHTML = item.mini_html;
            content.appendChild(content_text);

            // const likes_button = document.createElement("button");
            // likes_button.classList.add("toolbox-likes-button");


            const bookmark_button = document.createElement("button");
            bookmark_button.classList.add("toolbox-bookmark-button");

            const third_party = document.createElement("i");
            third_party.classList.add("toolbox-third-party");
            const bookmark_button_icon = document.createElement("i");
            if (item.is_bookmarked) {
                bookmark_button_icon.classList.add("toolbox-mark");
            }
            else {
                bookmark_button_icon.classList.add("toolbox-mark-empty");
            }
            bookmark_button.appendChild(bookmark_button_icon);
            bookmark_button.addEventListener('click', function () {
                const current_icon = this.querySelector('i');
                let current_bookmark_state;
                if(current_icon.classList.contains("toolbox-mark-empty")) {
                    current_icon.classList.remove("toolbox-mark-empty");
                    current_icon.classList.add("toolbox-mark");
                    current_bookmark_state = true;
                }
                else {
                    current_icon.classList.remove("toolbox-mark");
                    current_icon.classList.add("toolbox-mark-empty");
                    current_bookmark_state = false;
                }
                vscode.postMessage({ type: "submit_bookmark", function_name: item.function_name, state: current_bookmark_state });
            });
            const likes_button = document.createElement("button");
            likes_button.classList.add("toolbox-likes-button");
            likes_button.addEventListener('click', function () {
                const current_icon = this.querySelector('i');
                let current_like_state;
                if(current_icon.classList.contains("toolbox-like-empty")) {
                    current_icon.classList.remove("toolbox-like-empty");
                    current_icon.classList.add("toolbox-like");
                    current_like_state = 1;
                    this.querySelector('span').innerHTML = Number(this.querySelector('span').innerHTML) + Number(1);
                }
                else {
                    current_icon.classList.remove("toolbox-like");
                    current_icon.classList.add("toolbox-like-empty");
                    current_like_state = 0;
                    this.querySelector('span').innerHTML = Number(this.querySelector('span').innerHTML) - Number(1);
                }
                vscode.postMessage({ type: "submit_like", function_name: item.function_name, like: current_like_state });
            });
            const likes_button_icon = document.createElement("i");
            if (item.is_liked > 0) {
                likes_button_icon.classList.add("toolbox-like");
            } else {
                likes_button_icon.classList.add("toolbox-like-empty");
            }
            likes_button.appendChild(likes_button_icon);
            const likes_count = document.createElement("span");
            likes_count.innerHTML = item.likes;
            likes_button.appendChild(likes_count);

            const body_controls = document.createElement("div");
            body_controls.classList.add('toolbox-controls');
            body_controls.appendChild(third_party);
            body_controls.appendChild(likes_button);
            body_controls.appendChild(bookmark_button);


            // function label
            const label_wrapper = document.createElement("span");
            label_wrapper.innerHTML = item.label;
            // selection notice
            const selection_notice = document.createElement("div");
            selection_notice.classList.add('toolbox-notice');
            selection_notice.innerHTML = "";

            likes.appendChild(likes_icon);
            likes.appendChild(likes_span);
            bookmark.appendChild(bookmark_icon);

            header.appendChild(label_wrapper);
            // if(item.third_party === 1) {
            //     for(let i = 1; i <= item.metering; i++) {
            //         const third_party_icon = document.createElement("i");
            //         third_party_icon.classList.add("toolbox-third-party");
            //         header.appendChild(third_party_icon);
            //     }
            // }
            header.appendChild(bookmark);
            header.appendChild(likes);
            header.appendChild(run);

            contentActions.appendChild(backButton);
            contentActions.appendChild(run_clone);
            body.appendChild(selection_notice);
            body.appendChild(contentActions);
            body.appendChild(body_controls);
            body.appendChild(content);

            toolbox_item.appendChild(header);
            toolbox_item.appendChild(body);

            toolboxList.appendChild(toolbox_item);
        });
        on_how_many_lines_selected();
    } // it was renderToolbox()

    function on_how_many_lines_selected() {
        const toolboxItems = document.querySelectorAll(".toolbox-item");
        toolboxItems.forEach((item) => {
            let function_dict = JSON.parse(item.dataset.function);
            let run = item.querySelector(".toolbox-run");
            let content_run = item.querySelector(".toolbox-content-actions .toolbox-run");
            let notice = item.querySelector(".toolbox-notice");
            let selection_within_limits = (
                editor_inform_how_many_lines_selected >= function_dict.selected_lines_min &&
                editor_inform_how_many_lines_selected <= function_dict.selected_lines_max);
            let good_access_level = true;
            let access_level_msg = "";
            if (editor_inform_file_access_level === -1) {
                good_access_level = false;
            }
            if (editor_inform_file_access_level === 0) {
                good_access_level = false;
                access_level_msg = "Privacy: access to this file is restricted.";
            }
            if (editor_inform_file_access_level === 1 && function_dict.third_party) {
                good_access_level = false;
                access_level_msg = "Privacy: this function uses a third party API, which is not allowed for this file.";
            }
            if (!good_access_level) {
                run.classList.add('toolbox-run-disabled');
                content_run.classList.add('toolbox-run-disabled');
                if (access_level_msg) {
                    notice.style.display = 'inline-flex';
                    notice.innerHTML = access_level_msg;
                } else {
                    notice.style.display = 'none';
                }
            } else if (function_dict.supports_selection === 1 && function_dict.supports_highlight === 0 && !selection_within_limits) {
                run.classList.add('toolbox-run-disabled');
                content_run.classList.add('toolbox-run-disabled');
                notice.style.display = 'inline-flex';
                notice.innerHTML = `Please select ${function_dict.selected_lines_min}-${function_dict.selected_lines_max} lines of code.`;
            } else {
                run.classList.remove('toolbox-run-disabled');
                content_run.classList.remove('toolbox-run-disabled');
                notice.style.display = 'none';
            }
        });
    }

    function toolbox_update_likes() {
        renderToolbox(longthink_functions_today);
        toolboxSearch.addEventListener('input', function (event) {
            const filterItems = document.querySelectorAll(".toolbox-filter");
            reset_everything_about_commands();
            const searchTerm = this.value.toLowerCase();
            const itemsArray = Array.from(filterItems);
            if(searchTerm.endsWith("?")) {
                const chat = document.querySelector('[data-function_name="free-chat"]');
                chat.style.display = 'block';
                // chat.classList.add('item-selected');
                const parent = chat.parentNode;
                parent.insertBefore(chat, parent.firstChild);
            }
            else {
                const filteredDivs = itemsArray.filter(div => {
                    return div.dataset.title.toLowerCase().includes(searchTerm) || searchTerm==='';
                });
                filterItems.forEach(div => div.style.display = 'none');
                filteredDivs.forEach(div => div.style.display = 'block');
                if(filteredDivs.length === 0) {
                    if(editor_inform_how_many_lines_selected > 0 && searchTerm.length > 0) {
                        const refactor = document.querySelector('[data-function_name="select-and-refactor"]');
                        const parent = refactor.parentNode;
                        parent.insertBefore(refactor, parent.firstChild);
                    }
                    else {
                        const hl = document.querySelector('[data-function_name="hl-and-fix"]');
                        const parent = hl.parentNode;
                        parent.insertBefore(hl, parent.firstChild);
                    }
                }
            }
        });
        add_click_handler_on_toolbox_items();
    }

    function add_click_handler_on_toolbox_items(command) {
        const toolboxItems = document.querySelectorAll(".toolbox-item");
        toolboxItems.forEach((item) => {
            item.addEventListener("click", (event) => {
                if (event.target.tagName === 'SPAN') {
                    let active = document.querySelector(".item-active");
                    if (active) {
                        active.classList.remove("item-active");
                    }
                    item.classList.add("item-active");
                    const item_name = item.id;
                    const item_functions = longthink_functions_today[item_name];
                    if (item_functions.supports_highlight === 1) {
                        document.querySelector(".item-active .toolbox-notice").classList.add('toolbox-notice-hidden');
                    } else {
                        on_how_many_lines_selected();
                    }
                }
            });
        });
    }

    window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
            case "editor_inform":
                editor_inform_how_many_lines_selected = message.selected_lines_count;
                editor_inform_file_access_level = message.access_level;
                on_how_many_lines_selected();
                break;
            case "focus":
                toolboxSearch.focus();
                break;
            case "update_longthink_functions":
                longthink_functions_today = message.value;
                // toolbox_update_likes(); -- updates anyway, not needed
                break;
            // case "update_likes":
            //     longthink_functions_today = message.response;
            //     break;
            case "update_bookmarks_list":
                function_bookmarks = message.value;
                break;
            case "ts2web":
                let info = document.querySelector('.sidebar-logged');
                let plan = document.querySelector('.sidebar-plan');
                let coins = document.querySelector('.sidebar-coins');
                let login = document.querySelector('#login');
                let profile = document.querySelector('#profile');
                let data = document.querySelector('#datacollection');
                let logout = document.querySelector('#logout');
                let chat = document.querySelector('#chat');
                let bug = document.querySelector('#report_bugs');
                let privacy = document.querySelector('#privacy');
                let discord = document.querySelector('#discord');
                let settings = document.querySelector('#settings');

                discord.style.display = 'inline-flex';
                bug.style.display = 'inline-flex';
                info.style.display = message.ts2web_user ? 'flex' : '';
                plan.style.display = message.ts2web_plan ? 'flex' : '';
                document.querySelector('.sidebar-logged span').innerHTML = message.ts2web_user;
                document.querySelector('.sidebar-plan span').innerHTML = message.ts2web_plan;
                login.style.display = message.ts2web_user ? 'none' : 'block';
                profile.style.display = message.ts2web_user ? 'inline-flex' : 'none';
                logout.style.display = message.ts2web_user ? 'inline-flex' : 'none';
                chat.style.display = message.ts2web_user ? 'flex' : 'none';
                data.style.display = message.ts2web_user ? 'block' : 'none';
                coins.style.display = message.ts2web_user ? 'flex' : 'none';
                privacy.style.display = message.ts2web_user ? 'inline-flex' : 'none';
                settings.style.display = message.ts2web_user ? 'inline-flex' : 'none';

                if (message.ts2web_metering_balance) {
                    document.querySelector('.sidebar-coins span').innerHTML = Math.floor(message.ts2web_metering_balance / 100);
                }
                if (message.ts2web_longthink_functions) {
                    let json2 = JSON.stringify(message.ts2web_longthink_functions, null, 4);
                    if (longthink_functions_json !== json2) {
                        longthink_functions_today = message.ts2web_longthink_functions;
                        longthink_functions_json = json2;
                        toolbox_update_likes();
                    }
                }
                break;
        }
    });
})();
