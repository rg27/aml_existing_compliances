let currentAMLID = "";
let allCredentialsData = []; 

window.copyToClipboard = async (text, type) => {
    try {
        await navigator.clipboard.writeText(text);
        console.log(`${type} copied to clipboard`);
    } catch (err) {
        console.error('Failed to copy: ', err);
    }
};

ZOHO.embeddedApp.on("PageLoad", async (entity) => {
    currentAMLID = Array.isArray(entity.EntityId) ? entity.EntityId[0] : entity.EntityId;
    
    try {
        const fullWidth = `${window.innerWidth + 144}px`;
        const fullHeight = `${window.innerHeight}px`;
        
        await ZOHO.CRM.UI.Resize({ height: fullHeight, width: fullWidth });
        console.log(`Widget expanded to full page view: ${fullWidth} x ${fullHeight}`);

        const userRes = await ZOHO.CRM.CONFIG.getCurrentUser();
        const userProfile = userRes?.users?.[0]?.profile?.name;
        const mainWrapper = document.getElementById("main-wrapper");

        if (userProfile === "Administrator" || userProfile === "TA-Accountants" || userProfile === "TA-General Manager") {
            await loadCredentials(true);
        } else {
            mainWrapper.innerHTML = `
                <div class="flex items-center justify-center min-h-[250px] w-full p-2">
                    <div class="flex flex-col items-center justify-center space-y-2 max-w-xs w-full p-6 bg-white rounded-xl shadow-sm border border-slate-100">
                        <div class="text-center">
                            <h3 class="text-slate-600 font-semibold text-xs leading-tight">Unavailable</h3>
                        </div>
                    </div>
                </div>
                `;
        }
    } catch (error) {
        console.error("Initialization Error:", error);
    }
});

async function loadCredentials(isInitialLoad = false) {
    const tableBody = document.getElementById("credential-body");
    let logInterval = null;

    if (isInitialLoad) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="px-6 py-12 text-center text-slate-400 italic text-xs">
                    <div id="loading-log-container" class="inline-block text-left font-mono text-[10px] space-y-1 bg-slate-900 text-slate-300 p-4 rounded-lg shadow-inner max-w-sm w-full border border-slate-800">
                        <div class="text-slate-400">[01/04] Getting the compliance records...</div>
                    </div>
                </td>
            </tr>`;

        const logContainer = document.getElementById("loading-log-container");
        const logSteps = [
            '<div class="text-slate-400">[02/04] Checking & verifying AML stage...</div>',
            '<div class="text-slate-400">[03/04] Extracting last screened timestamps...</div>',
            '<div class="text-amber-400 animate-pulse">[04/04] Finalizing dataset parsing, please wait...</div>'
        ];
        let currentStep = 0;

        logInterval = setInterval(() => {
            if (currentStep < logSteps.length && logContainer) {
                logContainer.innerHTML += logSteps[currentStep];
                currentStep++;
            }
        }, 1200);
    }
    
    try {
        const payload = { "aml_id": currentAMLID };
        const args = { "arguments": JSON.stringify(payload) };
        
        console.log("=== [BEFORE EXECUTE] Zoho Function Arguments ===", args);
        const response = await ZOHO.CRM.FUNCTIONS.execute("get_all_previously_screened_records_v3", args);
        
        console.log("=== [AFTER EXECUTE] Zoho Function Raw Response ===", response);

        if (logInterval) clearInterval(logInterval);

        let rawOutput = response?.details?.output;
        let recordsArray = [];

        if (rawOutput) {
            if (typeof rawOutput === 'object') {
                if (Array.isArray(rawOutput)) {
                    recordsArray = rawOutput;
                } else if (rawOutput.data && Array.isArray(rawOutput.data)) {
                    recordsArray = rawOutput.data;
                }
            } else if (typeof rawOutput === 'string' && rawOutput.trim() !== "" && rawOutput.trim() !== "[]") {
                let cleaned = rawOutput.trim();
                if (!cleaned.startsWith("[")) {
                    cleaned = "[" + cleaned + "]";
                }
                let parsedData = JSON.parse(cleaned);
                if (Array.isArray(parsedData)) {
                    recordsArray = parsedData;
                } else if (parsedData && parsedData.data && Array.isArray(parsedData.data)) {
                    recordsArray = parsedData.data;
                }
            }
        }
        console.log("=== [PARSED] recordsArray length ===", recordsArray.length, recordsArray);

        if (recordsArray && recordsArray.length > 0) {
            recordsArray.sort((a, b) => {
                let rawA = a.aml_stage_modified_time ? a.aml_stage_modified_time.split('T')[0].replace(/[^0-9]/g, '') : '';
                let rawB = b.aml_stage_modified_time ? b.aml_stage_modified_time.split('T')[0].replace(/[^0-9]/g, '') : '';
                
                const numA = rawA ? parseInt(rawA, 10) : 0;
                const numB = rawB ? parseInt(rawB, 10) : 0;
                
                return numB - numA;
            });

            allCredentialsData = recordsArray; 
            tableBody.innerHTML = "";
            
            recordsArray.forEach((item, index) => {
                const row = document.createElement("tr");
                row.className = "hover:bg-slate-50 transition-colors group text-[11px]";
                
                const crVal = item.cr_score;
                const brVal = item.br_score;
                const grVal = item.gr_score;
                const srVal = item.sr_rating;
                const officerFrrVal = item.aml_officer_frr;
                const appTypeVal = item.app_type;
                const recordID = item.searched_aml_id || item.aml_id || item.id || "";
                const dateRaw = item.aml_stage_modified_time || "";

                let eddUrl = "";
                try {
                    const attachments = (item.attachments && item.attachments.data)
                        ? item.attachments.data
                        : [];

                    const tlzMatches = attachments.filter(function(a) {
                        return a.File_Name && a.File_Name.indexOf("TLZ Source of Wealth Declaration") !== -1;
                    });

                    if (tlzMatches.length > 0) {
                        const latest = tlzMatches.reduce(function(best, cur) {
                            return new Date(cur.Created_Time) > new Date(best.Created_Time) ? cur : best;
                        });

                        const linkUrl   = latest["$link_url"] || "";
                        const entityId  = item.searched_aml_id || "";
                        const authId    = encodeURIComponent(
                            JSON.stringify({ module: "3769920000187099442", entity_id: entityId })
                        );

                        eddUrl = linkUrl + "?authId=" + authId;
                    }
                } catch (eddErr) {
                    console.error("EDD parse error for record index " + index + ":", eddErr, item);
                }

                const targetURL = recordID ? `https://crm.zoho.com/crm/org682300086/tab/CustomModule49/${recordID}` : "#";
                
                let dateDisplay = '-';
                if (dateRaw && dateRaw.trim() !== "") {
                    const dateObj = new Date(dateRaw);
                    if (!isNaN(dateObj.getTime())) {
                        dateDisplay = dateObj.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                    }
                }

                const isCrEmpty = crVal === "" || crVal === null || crVal === undefined;
                const isBrEmpty = brVal === "" || brVal === null || brVal === undefined;
                const isGrEmpty = grVal === "" || grVal === null || grVal === undefined;
                const isSrEmpty = srVal === "" || srVal === null || srVal === undefined;
                const isOfficerFrrEmpty = officerFrrVal === "" || officerFrrVal === null || officerFrrVal === undefined;
                const isAppTypeEmpty = appTypeVal === "" || appTypeVal === null || appTypeVal === undefined;

                let scoreColumnsHTML = "";

                if (isCrEmpty && isBrEmpty && isGrEmpty) {
                    scoreColumnsHTML = `
                        <td colspan="6" class="px-3 py-2.5 text-center">
                            <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-[9px] font-medium tracking-tight uppercase border border-slate-200/60 select-none">
                                Old Version
                            </span>
                        </td>`;
                } else {
                    let scoreBadge = "bg-slate-100 text-slate-600 border-slate-200";
                    if (!isCrEmpty) {
                        const numericCr = parseFloat(crVal);
                        if (numericCr >= 25) scoreBadge = "bg-red-50 text-red-700 border-red-100";
                        else if (numericCr >= 11) scoreBadge = "bg-amber-50 text-amber-700 border-amber-100";
                        else scoreBadge = "bg-emerald-50 text-emerald-700 border-emerald-100";
                    }
                    const crDisplay = !isCrEmpty ? crVal : '-';
                    const brDisplay = !isBrEmpty ? brVal : '0';
                    const grDisplay = !isGrEmpty ? grVal : '0';
                    const srDisplay = !isSrEmpty ? srVal : '-';
                    const officerFrrDisplay = !isOfficerFrrEmpty ? officerFrrVal : '-';
                    const appTypeDisplay = !isAppTypeEmpty ? appTypeVal : '-';

                    scoreColumnsHTML = `
                        <td class="px-3 py-2.5 text-center">
                            <span class="px-1 py-0.5 rounded text-[9px] font-bold border ${scoreBadge}">${crDisplay}</span>
                        </td>
                        <td class="px-3 py-2.5 text-center font-medium text-slate-600">${brDisplay}</td>
                        <td class="px-3 py-2.5 text-center font-medium text-slate-600">${grDisplay}</td>
                        <td class="px-3 py-2.5 text-center font-medium text-slate-600">${srDisplay}</td>
                        <td class="px-3 py-2.5 text-center font-medium text-slate-600">${officerFrrDisplay}</td>
                        <td class="px-3 py-2.5 text-center font-medium text-slate-600">${appTypeDisplay}</td>`;
                }

                row.innerHTML = `
                    <td class="px-3 py-2.5 text-slate-700 font-medium">
                        <div class="flex items-center space-x-1">
                            ${targetURL !== "#" ? `
                                <a href="${targetURL}" target="_blank" class="text-blue-600 hover:text-blue-800 underline underline-offset-2 font-semibold transition-colors">${item.compliance_name || '-'}</a>
                            ` : `<span>${item.compliance_name || '-'}</span>`}
                            <button onclick="copyToClipboard('${item.compliance_name || ''}', 'Compliance Name')" class="text-slate-300 hover:text-slate-600 transition-colors">
                                <i data-lucide="copy" class="w-2.5 h-2.5"></i>
                            </button>
                        </div>
                    </td>
                    ${scoreColumnsHTML}
                    <td class="px-3 py-2.5 text-center text-slate-500">${dateDisplay}</td>
                    <td class="px-3 py-2.5 text-center">
                        ${eddUrl && eddUrl.trim() !== "" && eddUrl !== "-" ? `
                            <a href="${eddUrl}" target="_blank" class="inline-flex items-center space-x-1 text-red-600 hover:text-red-800 font-medium transition-colors">
                                <i data-lucide="file-text" class="w-3 h-3"></i>
                                <span>PDF</span>
                            </a>
                        ` : `
                            <span class="text-slate-400 text-[10px] font-medium tracking-wider select-none">N/A</span>
                        `}
                    </td>`;
                tableBody.appendChild(row);
            });
            lucide.createIcons();
            
            setTimeout(async () => {
                await ZOHO.CRM.UI.Resize({ height: `${window.innerHeight}px`, width: `${window.innerWidth + 144}px` });
            }, 100);

        } else {
            allCredentialsData = [];
            tableBody.innerHTML = `<tr><td colspan="9" class="px-2 py-8 text-center text-slate-400 font-medium italic text-[11px]">No Records</td></tr>`;
        }
    } catch (e) { 
        if (logInterval) clearInterval(logInterval);
        console.error("Execution or Parse Error:", e);
        allCredentialsData = [];
        tableBody.innerHTML = `<tr><td colspan="9" class="px-2 py-8 text-center text-slate-400 font-medium italic text-[11px]">No Records</td></tr>`;
    }
}

ZOHO.embeddedApp.init();