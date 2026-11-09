"use strict";
/* The fixed activity list for the two days (Day 1 and Day 2, 25-26 November 2026).
   The PowerPoint is presented separately; this page only runs the activities.
   Built from the facilitation deck v20261109B (tagged activity slides and their session footers) and the
   Materials v20261106B (D2, D4 to D7, D9 to D12).
   kind "form": answered on each person's phone.
   kind "sheet": one sheet per table (T1-T4), per clinic (C1-C3) or one staff register (ROOM), filled on a group device or by staff.
   kind "gallery": phones mark the indicators they support, from the revealed D6 matrices.
   kind "link": opens an outside link.
   To change the program, edit PROGRAM below (order, session names, times) or an entry in ACTIVITIES. */
window.PK_AGENDA = (function () {
  var ABCD = [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]];
  var OPTS = ["A", "B", "C", "D"];
  var TABLES = ["T1", "T2", "T3", "T4"];
  // the eight comparison questions of D2 (weights are agreed in plenary and entered on the Settings tab)
  var CRIT = [
    ["equity", "Patas: equity"], ["speed", "Mabilis: speed to results"], ["account", "Mapagkakatiwalaan: accountability"],
    ["devolution", "Feasibility under devolution"], ["workforce", "Workforce sustainability"], ["financing", "Financing sustainability"],
    ["evidence", "Strength of evidence"], ["transition", "Transition cost (5 = least disruptive)"]
  ];
  // D10: regional minimum = national target x region population / national population. Estimates, not DOH targets.
  var NAT = { pop: 112729484, register: 60000000, screen: 48000000 };
  var REGIONS = [
    ["R1", "Ilocos Region (Region I)", 5342453], ["R2", "Cagayan Valley (Region II)", 3777608], ["R3", "Central Luzon (Region III)", 12989074],
    ["R4A", "CALABARZON (Region IV-A)", 16933234], ["R4B", "MIMAROPA (Region IV-B)", 3245446], ["R5", "Bicol Region (Region V)", 6064426],
    ["R6", "Western Visayas (Region VI)", 4861911], ["NIR", "Negros Island Region", 4904944], ["R7", "Central Visayas (Region VII)", 6640875],
    ["R8", "Eastern Visayas (Region VIII)", 4625929], ["R9", "Zamboanga Peninsula (Region IX)", 3943837], ["R10", "Northern Mindanao (Region X)", 5178326],
    ["R11", "Davao Region (Region XI)", 5389422], ["R12", "SOCCSKSARGEN (Region XII)", 4462776], ["R13", "CARAGA (Region XIII)", 2865196],
    ["NCR", "National Capital Region", 14001751], ["CAR", "Cordillera Administrative Region", 1808985], ["BARMM", "BARMM", 5691583]
  ];
  var GROUP_OPTS = ["Regional", "Local implementers", "National level", "Other"];

  var ACTIVITIES = {
    // ---------- Day 1 ----------
    accept_contest: { title: "Accept or contest: Where PK stands", kind: "form", items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] }] },

    d9_models: { title: "D9 models matrix and core or adaptable elements", kind: "sheet", sheets: TABLES,
      intro: "Correct and add models (Part A). Then confirm or move each element between core and adaptable (Part B). Unsettled elements go to the design-questions register; do not force agreement.",
      sections: [
        { id: "a", title: "Part A. Existing and alternative models", type: "rows", add: "Add a model", cols: [
          { id: "model", label: "Model" }, { id: "where", label: "Where and who runs it" }, { id: "services", label: "Services" },
          { id: "providers", label: "Providers" }, { id: "ops", label: "Operational arrangements" }, { id: "me", label: "Monitoring and evaluation" },
          { id: "status", label: "Evidence", type: "select", options: ["Documented", "Reported by a participant", "Unknown"] }] },
        { id: "b", title: "Part B. Core and adaptable elements", type: "rows", add: "Add an element",
          preset: ["Service package", "Targeting", "Workforce", "Supervision", "Supplies", "Data", "Financing", "Governance"], presetCol: "element",
          cols: [
            { id: "element", label: "Element" },
            { id: "class", label: "Core or adaptable", type: "select", options: ["Core", "Adaptable", "Not settled: send to the register"] },
            { id: "break", label: "What would break if it varied?" }, { id: "options", label: "Options it matters for" },
            { id: "open", label: "Open question" }, { id: "una", label: "UNA link" }] }
      ] },

    weights_choice: { title: "Weights: pre-work or equal", kind: "form", items: [
      { id: "weights", label: "Which weights do you prefer?", type: "single", options: [["prework", "Pre-work weights"], ["equal", "Equal weights"]] }] },

    accept_contest_option: { title: "Preference result: accept or contest", kind: "form", items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] },
      { id: "option", label: "If you contest, which option would you put forward instead?", type: "single", options: ABCD, showIf: { item: "answer", value: "contest" } }] },

    d2_score: { title: "D2 silent scores (each person)", kind: "form", resultMode: "spread",
      help: "Score each option from 1 to 5, where 5 is strongest. Work alone and in silence.",
      grid: { rows: CRIT, cols: OPTS, scale: ["1", "2", "3", "4", "5"] } },

    d2_table: { title: "D2 options appraisal: the table's agreed scores", kind: "sheet", sheets: TABLES, spreadOf: "d2_score", weighted: true,
      intro: "Discuss where the silent scores differ by two points or more. Write the table's agreed score and a one-line reason for every option.",
      sections: [
        { id: "m", title: "Agreed scores (1 to 5, 5 is strongest)", type: "matrix", rows: CRIT, opts: OPTS },
        { id: "req", title: "Requirement (not scored): contribution to the 60 million registered and 48 million screened", type: "perOption", opts: OPTS,
          help: "For each option: how it would contribute in the regions at your table, and what it would need." },
        { id: "r", title: "Group reflection", type: "fields", fields: [
          { id: "strongest", label: "Which option did your group find strongest, and on which criteria?" },
          { id: "hybrid", label: "What hybrid, if any, would combine the strengths you saw?" },
          { id: "change", label: "What would make you change your assessment?" }] }
      ] },

    departures: { title: "Departures from the pre-work", kind: "sheet", sheets: TABLES,
      intro: "Mark every option where your table is clearly above or below the pre-work result, with one sentence of reason.",
      sections: [
        { id: "d", title: "Departures", type: "rows", fixedRows: OPTS.map(function (o) { return ["opt" + o, "Option " + o]; }), labelCol: "Option", cols: [
          { id: "dir", label: "Compared with the pre-work", type: "select", options: ["Above", "Below", "About the same"] },
          { id: "criteria", label: "Criteria where you depart" },
          { id: "reason", label: "What does your table know that the pre-work did not capture?" }] }
      ] },

    hybrid: { title: "Hybrid line", kind: "sheet", sheets: TABLES,
      intro: "Is there an element of one option that fixes the main weakness of another? Do not score it today.",
      sections: [
        { id: "h", title: "Hybrid proposal", type: "fields", fields: [
          { id: "base", label: "Base option", type: "select", options: OPTS },
          { id: "borrowed", label: "Element borrowed" },
          { id: "from", label: "Borrowed from option", type: "select", options: OPTS },
          { id: "true", label: "What would have to be true for it to work" },
          { id: "risk", label: "Main risk it adds" }] }
      ] },

    ballot_d3: { title: "Individual ballot (D3)", kind: "form", items: [
      { id: "first", label: "My preferred option is", type: "single", options: ABCD.concat([["Hybrid", "Hybrid"]]) },
      { id: "hybrid_text", label: "Describe your hybrid", type: "text", showIf: { item: "first", value: "Hybrid" } },
      { id: "second", label: "My second choice is", type: "single", options: ABCD.concat([["None", "None"]]) },
      { id: "no_support", label: "An option I could not support under any conditions (choose any, or none)", type: "multi", options: ABCD },
      { id: "no_support_because", label: "Because", type: "text", showIf: { item: "no_support", filled: true } },
      { id: "condition", label: "A condition under which my first choice would work", type: "text" }] },

    regional_worksheet: { title: "Reaching-the-numbers worksheet (D10)", kind: "sheet", sheets: TABLES,
      intro: "Add the regions at your table; the minimum numbers fill in by themselves. They are estimates (national target x the region's share of the population), not DOH targets. Record disagreement rather than averaging it away.",
      sections: [
        { id: "reg", title: "Regions at your table", type: "rows", add: "Add a region", cols: [
          { id: "region", label: "Region", type: "region" },
          { id: "facilities", label: "What could be reached through facilities" },
          { id: "agencies", label: "What through other agencies" },
          { id: "community", label: "What is left for community-based work" },
          { id: "needs", label: "What it would need; option it depends on" }] },
        { id: "v", title: "Each option: can it reach the numbers in your regions?", type: "rows", fixedRows: OPTS.map(function (o) { return ["opt" + o, "Option " + o]; }), labelCol: "Option", cols: [
          { id: "verdict", label: "Verdict", type: "select", options: ["Reaches the numbers", "Reaches them with conditions", "Does not reach them"] },
          { id: "finding", label: "One finding" }, { id: "condition", label: "One condition" }] }
      ] },

    // ---------- Day 2 ----------
    correction: { title: "Corrections to the summary", kind: "sheet", sheets: TABLES,
      intro: "Mark anything in the one-page summary that does not match what your table said yesterday.",
      sections: [{ id: "c", title: "Corrections", type: "rows", add: "Add a correction", cols: [
        { id: "wrote", label: "What we wrote" }, { id: "should", label: "What it should say" }] }] },

    case_for_against: { title: "Case for and against the carried direction", kind: "sheet", sheets: TABLES,
      intro: "Tables 1 and 3 prepare the case FOR the carried direction; tables 2 and 4 prepare the case AGAINST. Argue your side even if you disagree.",
      sideBySheet: { T1: "For", T2: "Against", T3: "For", T4: "Against" },
      sections: [{ id: "k", title: "Your three strongest points", type: "fields", fields: [
        { id: "p1", label: "Point 1" }, { id: "p2", label: "Point 2" }, { id: "p3", label: "Point 3" },
        { id: "change", label: "The one thing that would change your mind" }] }] },

    consent_d4: { title: "Consent level (D4)", kind: "form", items: [
      { id: "level", label: "My level of consent", type: "scale", options: [
        ["1", "Cannot support; alternative proposed"], ["2", "Serious reservations; conditions needed"], ["3", "Can live with it; concerns recorded"],
        ["4", "Support with minor concerns"], ["5", "Fully support"]] },
      { id: "reason", label: "My reason, condition or alternative (needed for level 1 or 2)", type: "text" }] },

    conditions_register: { title: "Conditions and reservations register (D4)", kind: "sheet", sheets: ["ROOM"], staffOnly: true,
      intro: "Staff write each reason given in the consent round as a concern or a condition. Group only, never a name.",
      sections: [{ id: "c", title: "Register", type: "rows", add: "Add a condition or reservation", cols: [
        { id: "raised", label: "Condition or reservation raised" },
        { id: "kind", label: "Concern or condition", type: "select", options: ["Concern", "Condition"] },
        { id: "by", label: "Raised by (group only)", type: "select", options: GROUP_OPTS },
        { id: "response", label: "Response or design implication" }] }] },

    clinic_d5_1: { title: "Clinic 1 (D5): targeting, eligibility and data", kind: "sheet", sheets: ["C1"], clinic: true,
      intro: "Who is prioritized, using what data, how often? What happens to communities that are not prioritized, or that improve and graduate? What data identify the people or communities concerned, who holds them, and how often are they refreshed?",
      sections: [{ id: "q", title: "Design questions", type: "rows", add: "Add a design question", cols: [
        { id: "question", label: "Design question" }, { id: "answer", label: "Proposed answer" }, { id: "open", label: "Open issue" },
        { id: "owner", label: "Owner (office)" }, { id: "by", label: "Decide by" }, { id: "una", label: "UNA link" },
        { id: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] }] }] },
    clinic_d5_2: { title: "Clinic 2 (D5): service scope, workforce and routes to the numbers", kind: "sheet", sheets: ["C2"], clinic: true,
      intro: "What functions are fixed nationally? What is chosen locally? How is linkage to YAKAP, GAMOT and referral networks guaranteed? Who delivers, and how are BHWs paid, supervised and trained? How are the regional minimum numbers reached (see D10)?",
      sections: [{ id: "q", title: "Design questions", type: "rows", add: "Add a design question", cols: [
        { id: "question", label: "Design question" }, { id: "answer", label: "Proposed answer" }, { id: "open", label: "Open issue" },
        { id: "owner", label: "Owner (office)" }, { id: "by", label: "Decide by" }, { id: "una", label: "UNA link" },
        { id: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] }] }] },
    clinic_d5_3: { title: "Clinic 3 (D5): financing, governance and transition", kind: "sheet", sheets: ["C3"], clinic: true,
      intro: "Which channels apply: NEP, Special Health Fund, LHSML grants, PhilHealth, partners? Is any allocation weighted by need? Which office owns what? How does the 2026-2027 transition work?",
      sections: [{ id: "q", title: "Design questions", type: "rows", add: "Add a design question", cols: [
        { id: "question", label: "Design question" }, { id: "answer", label: "Proposed answer" }, { id: "open", label: "Open issue" },
        { id: "owner", label: "Owner (office)" }, { id: "by", label: "Decide by" }, { id: "una", label: "UNA link" },
        { id: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] }] }] },

    indicators_d6: { title: "Targets and indicators matrix (D6)", kind: "sheet", sheets: TABLES,
      levelBySheet: { T1: "National / Executive Committee", T2: "CHD / MOH-BARMM", T3: "LGU / province", T4: "Barangay" },
      intro: "Accept or contest each pre-work result placed on your row. For each result you keep, write the decision it supports and who makes it; a result with no decision does not stay. Add up to two missing results. Mark your top three.",
      sections: [{ id: "i", title: "Your level", type: "rows", add: "Add a result", cols: [
        { id: "result", label: "Result (from the pre-work or added)" },
        { id: "source", label: "Source", type: "select", options: ["From the pre-work", "Added by the table"] },
        { id: "accept", label: "Accept or contest", type: "select", options: ["Accept", "Contest"] },
        { id: "why", label: "If contested, why" },
        { id: "decision", label: "Decision supported, and who decides" },
        { id: "indicator", label: "Question the monitoring system must answer; candidate indicator or target" },
        { id: "data", label: "Likely data source; feasibility" },
        { id: "una", label: "UNA deliverable it informs" },
        { id: "top", label: "Top three", type: "check" }] }],
      prompts: ["Are we reaching those with the greatest needs (Patas)?", "Are people who are screened actually linked to care (Pillar 3)?",
        "Is effort rising where need is greater, or falling?", "Can results be reported within the 30-day review cycle (Mabilis)?",
        "What must not be added to LGU reporting burden?", "Where will barangay-level data come from?",
        "Is equity targeting itself being monitored, separately from coverage?"] },

    gallery_walk: { title: "Gallery walk: mark what you support", kind: "gallery", source: "indicators_d6", sourceSection: "i", sourceCol: "indicator", resultMode: "spread",
      help: "Choose up to three indicators you support. You can also mark any you cannot support." },

    partner_d7: { title: "Partner alignment matrix (D7)", kind: "sheet", sheets: TABLES,
      intro: "Partners and DOH offices each fill in a row. The matrix goes to BIHC as an input to the partner resource plan.",
      sections: [{ id: "p", title: "Partners and offices", type: "rows", add: "Add a partner or office", cols: [
        { id: "partner", label: "Partner or office" }, { id: "current", label: "Current support relevant to PK" },
        { id: "pillar", label: "UNA pillar and sub-component" },
        { id: "fit", label: "Fit with the preferred direction", type: "select", options: ["High", "Partial", "Low"] },
        { id: "realign", label: "Possible realignment, next 16 months" },
        { id: "gap", label: "Gap the Department should seek support for" }] }] },

    action_register: { title: "Action register (read-out)", kind: "sheet", sheets: ["ROOM"], staffOnly: true, flagMissing: ["owner", "when"],
      intro: "Staff type each action as the rapporteur reads it out. Anything with no owner or no date is flagged for follow-up.",
      sections: [{ id: "a", title: "Actions", type: "rows", add: "Add an action", cols: [
        { id: "action", label: "Action" }, { id: "owner", label: "Who owns it" }, { id: "when", label: "By when" },
        { id: "table", label: "From", type: "select", options: ["Table 1", "Table 2", "Table 3", "Table 4", "Other"] },
        { id: "reply", label: "Owner's answer", type: "select", options: ["Yes", "No", "Not in the room"] }] }] },

    evaluation: { title: "Evaluation (D8)", kind: "link" },

    // ---------- staff registers used on both days ----------
    results_contest: { title: "Results and contest sheet (D12)", kind: "sheet", sheets: ["ROOM"], staffOnly: true,
      intro: "One row per topic. An uncontested result is carried; a contested one is settled by show of hands (by ballot D3 for the option preference).",
      sections: [{ id: "t", title: "Topics", type: "rows", add: "Add a topic", cols: [
        { id: "topic", label: "Topic" }, { id: "items", label: "Items" }, { id: "result", label: "Result (counts, by combined group)" },
        { id: "flag", label: "Flag before the session" }, { id: "contest", label: "Contested by (group only) and reason" },
        { id: "outcome", label: "Outcome", type: "select", options: ["Carried", "Amended", "Overturned"] }, { id: "vote", label: "Vote" }] }] },
    design_questions: { title: "Design-questions register", kind: "sheet", sheets: ["ROOM"], staffOnly: true,
      intro: "Anything unsettled (for example from D9 Part B) goes here for the Day 2 clinics.",
      sections: [{ id: "q", title: "Register", type: "rows", add: "Add a question", cols: [
        { id: "question", label: "Design question or unsettled element" }, { id: "from", label: "Raised in (session, table)" },
        { id: "clinic", label: "Clinic", type: "select", options: ["Clinic 1", "Clinic 2", "Clinic 3", "Not assigned"] },
        { id: "status", label: "Status", type: "select", options: ["Open", "Answered in a clinic", "Parked"] }] }] }
  };

  // Program order. Each block is one part of a session, with its time.
  var PROGRAM = [
    { day: "Day 1 · Wednesday 25 November", blocks: [
      { session: "Both days", name: "Staff registers", time: "", acts: ["results_contest", "design_questions"] },
      { session: "Session 0", name: "Clarifying questions", time: "09:20–10:10", acts: ["accept_contest"] },
      { session: "Session 1", name: "Table work", time: "10:15–10:45", acts: ["d9_models"] },
      { session: "Session 2", name: "Weights", time: "11:35–11:43", acts: ["weights_choice"] },
      { session: "Session 3", name: "Contest round", time: "13:10–13:20", acts: ["accept_contest_option"] },
      { session: "Session 3", name: "Scoring", time: "13:20–14:05", acts: ["d2_score", "d2_table"] },
      { session: "Session 3", name: "Departures", time: "14:05–14:15", acts: ["departures"] },
      { session: "Session 3", name: "Hybrids", time: "14:15–14:20", acts: ["hybrid"] },
      { session: "Session 3", name: "Ballot, only if contested", time: "14:20–14:35", acts: ["ballot_d3"] },
      { session: "Session 4", name: "Worksheet", time: "14:58–15:30", acts: ["regional_worksheet"] }
    ] },
    { day: "Day 2 · Thursday 26 November", blocks: [
      { session: "Both days", name: "Staff registers", time: "", acts: ["results_contest", "design_questions"] },
      { session: "Synthesis", name: "Corrections", time: "09:14–09:20", acts: ["correction"] },
      { session: "Session 5", name: "Case for and against", time: "09:25–09:40", acts: ["case_for_against"] },
      { session: "Session 5", name: "Consent round", time: "10:50–11:10", acts: ["consent_d4", "conditions_register"] },
      { session: "Session 6", name: "Clinics", time: "12:40–13:25", acts: ["clinic_d5_1", "clinic_d5_2", "clinic_d5_3"] },
      { session: "Session 7", name: "Matrix work", time: "14:05–14:35", acts: ["indicators_d6"] },
      { session: "Session 7", name: "Harvest", time: "14:35–14:50", acts: ["gallery_walk"] },
      { session: "Session 8", name: "Partner matrix", time: "14:50–15:15", acts: ["partner_d7"] },
      { session: "Session 8", name: "Read-out", time: "15:15–15:25", acts: ["action_register"] },
      { session: "Session 9", name: "Evaluation", time: "15:40–15:50", acts: ["evaluation"] }
    ] }
  ];

  // D11, the one-page table guide, shown on group devices
  var GUIDE = [
    ["Roles", "The chair is a regional participant who is not the most senior at the table; the chair keeps time and makes sure every voice is heard. The rapporteur fills the sheets on this device. One of the four BLHSD staff anchors each table and acts as the resource person."],
    ["Order of work", "The pre-work results are the group's starting vote: accept a result or contest it. A table that scores options on D2 scores first and then compares with the pre-work result."],
    ["Recording", "Write a one-line reason for every score. Record disagreements and minority positions as they are said; do not average them away."],
    ["Departing from the pre-work result", "Mark the option and criterion where the table's result differs from the pre-work, and give one sentence of reason."],
    ["Counts and confidentiality", "The pre-work results are counts for combined groups. Do not try to work out who answered what."]
  ];

  return { activities: ACTIVITIES, program: PROGRAM, crit: CRIT, opts: OPTS, regions: REGIONS, nat: NAT, guide: GUIDE };
})();
