"use strict";
/* The fixed activity list and the slide order for the two days (25-26 November 2026).
   The PowerPoint is presented separately; this page only runs the activities, one slide at a time:
   whatever slide the staff screen shows is the slide the phones answer.
   Arranged to match the participant report v20261120D (Sessions 0 to 8), as redesigned on 23-24 November.
   kind "form": answered on each person's phone, on their own.
   kind "sheet": one sheet per table (T1-T4), per clinic (C1-C3), or one staff sheet (ROOM).
     A sheet with "view" is drawn by its own code in room.js (the starting elements, the table's choice, the test,
     the two merge grids, the indicator sheets).
   kind "link": opens an outside link.
   The words of the Session 2 starting elements and of the pre-work indicator list are NOT here: they are
   consultation content, kept in a private note and entered by staff into the staff sheets before the session. */
window.PK_AGENDA = (function () {
  var TABLES = ["T1", "T2", "T3", "T4"];
  // the eight questions (Session 1 weights; Session 2 test)
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
  // D10 routes; "oth" opens "specify other" when above 0%
  var ROUTES = [["fac", "Facilities"], ["agn", "Other agencies"], ["com", "Community-based work"], ["oth", "Others"]];
  var LEVELS = ["National", "Regional", "Province or city", "Municipality", "Barangay"];

  // Session 6 guide questions: generic, so they work whichever option or mix becomes the direction.
  // Each topic is a section; each question is one row (answer: how, still to decide, who will implement).
  function clinic(id, sheet, title, topics) {
    var secs = topics.map(function (t, i) {
      return { id: "t" + (i + 1), title: t[0], type: "rows", fixedRows: t[1].map(function (q, j) { return ["q" + (j + 1), q]; }), labelCol: "Guide question", cols: CLINIC_COLS };
    });
    secs.push({ id: "add", title: "Anything else the policy needs", type: "rows", add: "Add a row", cols: [{ id: "topic", label: "What it is about" }].concat(CLINIC_COLS) });
    return { title: title, kind: "sheet", sheets: [sheet], clinic: true, showDirection: true,
      intro: "Under the direction agreed in Session 2, say how the new PK will work for your topic. Each answer becomes part of the new PK policy.", sections: secs };
  }
  var CLINIC_COLS = [
    { id: "how", label: "How the new PK will do this" },
    { id: "decide", label: "What still has to be decided" },
    { id: "who", label: "Who will implement" }];

  var IND_INTRO = "For each component the plenary agreed in Session 6, write a specific indicator: what would show it is working, where it is measured, the data source, and who uses it to decide what. Include only indicators you consider feasible.";

  var ACTIVITIES = {
    // ---------- Day 1 ----------
    s0_clarify: { title: "Your clarifying question about the results", kind: "form", texts: true, items: [
      { id: "q", label: "What would you like clarified about the pre-work results?", type: "text" }] },
    s0_question: { title: "Is there a result you would question?", kind: "form", texts: true, items: [
      { id: "answer", label: "Do you accept the results as they are, or is there one you would question?", type: "single", options: [["accept", "I accept them"], ["question", "I would question a result"]] },
      { id: "which", label: "Which result?", type: "text", showIf: { item: "answer", value: "question" } },
      { id: "why", label: "Why?", type: "text", showIf: { item: "answer", value: "question" } }] },

    s1_weights: { title: "The weights from the pre-work ranking", kind: "form", texts: true, items: [
      { id: "answer", label: "Do you accept the weights for the eight questions from the pre-work ranking?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] },
      { id: "why", label: "Why do you contest them?", type: "text", showIf: { item: "answer", value: "contest" } }] },
    s1_vote: { title: "Vote: which weights?", kind: "form", items: [
      { id: "weights", label: "Which weights should the room use?", type: "single", options: [["prework", "The weights from the pre-work ranking"], ["equal", "Equal weights"]] }] },

    s2_start: { title: "The starting elements", kind: "sheet", sheets: ["ROOM"], staffOnly: true, view: "start", importable: true,
      intro: "From the pre-work: what people would take from each option (80 people who chose a mix, 183 answers). Each row is one idea. Staff enter or paste these before the session.",
      sections: [
        { id: "e", title: "Elements (one idea each)", type: "rows", add: "Add an element", cols: [
          { id: "theme", label: "Theme and pre-work basis" }, { id: "phrase", label: "Connecting phrase" }, { id: "element", label: "Element" }] },
        { id: "s", title: "Stakeholders", type: "rows", add: "Add a stakeholder", cols: [{ id: "name", label: "Stakeholder" }] },
        { id: "r", title: "Role options (the same for every stakeholder)", type: "rows", add: "Add a role", cols: [{ id: "role", label: "Role" }] },
        { id: "m", title: "Stakeholder section heading", type: "fields", fields: [
          { id: "theme", label: "Theme and pre-work basis for the stakeholder roles" }] }] },
    s2_choose: { title: "Choose your table's elements", kind: "sheet", sheets: TABLES, view: "choose",
      intro: "Tick every element your table wants in the new PK. Add your own under any sentence. Your table's direction is written below as you tick." },
    s2_test: { title: "Test your direction on the eight questions", kind: "sheet", sheets: TABLES, view: "test",
      intro: "Score your table's direction from 1 to 5 on each question, where 5 is strongest, with a one-line reason." },
    s2_merge: { title: "The one direction (merge)", kind: "sheet", sheets: ["ROOM"], staffOnly: true, view: "merge2",
      intro: "What each table chose, element by element. Staff type the final agreed element in the last column; the one direction is written below." },
    s2_agree: { title: "Agreement check", kind: "form", texts: true, items: [
      { id: "level", label: "How far do you agree with the one direction?", type: "scale", options: [["1", "Cannot agree"], ["2", "Strong doubts"], ["3", "Can live with it"], ["4", "Agree"], ["5", "Fully agree"]] },
      { id: "why", label: "What would make it work for you?", type: "text", showIf: { item: "level", values: ["1", "2"] } }] },

    s3_carry: { title: "What can be carried over", kind: "form", texts: true, items: [
      { id: "text", label: "Which elements of PK can be carried over to the new direction, and why?", type: "text" }] },
    s3_settled: { title: "Elements the pre-work already settles", kind: "form", texts: true, items: [
      { id: "answer", label: "Do you confirm the elements the pre-work already settles?", type: "single", options: [["confirm", "Confirm"], ["contest", "Contest one or more"]] },
      { id: "which", label: "Which, and why?", type: "text", showIf: { item: "answer", value: "contest" } }] },
    d9_models: { title: "Models, and core or adaptable elements (D9)", kind: "sheet", sheets: TABLES,
      intro: "Correct and add models (Part A). Then confirm or move each element between core and adaptable (Part B). Elements you cannot classify go to the design-questions register; do not force agreement.",
      sections: [
        { id: "a", title: "Part A. Existing and alternative models", type: "rows", add: "Add a model", cols: [
          { id: "model", label: "Model" }, { id: "where", label: "Where and who runs it" }, { id: "services", label: "Services" },
          { id: "providers", label: "Providers" }, { id: "ops", label: "Operational arrangements" }, { id: "me", label: "Monitoring and evaluation" },
          { id: "status", label: "Evidence", type: "select", options: ["Documented", "Reported by a participant", "Unknown"] }] },
        { id: "b", title: "Part B. Core and adaptable elements", type: "rows", add: "Add an element",
          preset: ["Service package", "Targeting", "Workforce", "Supervision", "Supplies", "Data", "Financing", "Governance"], presetCol: "element",
          cols: [
            { id: "element", label: "Element" },
            { id: "class", label: "Core or adaptable", type: "select", options: ["Core", "Adaptable", "Cannot classify: send to the register"] },
            { id: "break", label: "What would break if it varied?" },
            { id: "open", label: "Open question" }, { id: "una", label: "UNA link" }] }
      ] },

    d10: { title: "Your region's routes to the UNA numbers (D10)", kind: "form", d10: true, live: true,
      help: "Choose your region. Split how it will reach its minimum numbers across the routes; the shares must add up to 100%. Each share shows its estimated count." },

    // ---------- Day 2 ----------
    c6_1: clinic("c6_1", "C1", "Clinic 1: targeting, eligibility and data", [
      ["Finding the people and communities the new PK serves", [
        "How will the new PK identify the people or communities it serves, and from which sources?",
        "Who does this at each level, and how often is it repeated?",
        "When sources disagree or someone is missed, how is it settled, and how is that person or community added?"]],
      ["Eligibility", [
        "How is it confirmed that a person or community is covered, who confirms it, and with what proof?",
        "When does a person or community start or stop receiving PK support, and who decides?",
        "How is a person handed over between settings (home, community, facility) so that care continues?"]],
      ["Data", [
        "What does every site record as a minimum, and in which system, so that nothing is entered twice?",
        "Who reports to whom, how often, and who checks the quality of the data?",
        "How is personal data protected, and who may see what?"]]]),
    c6_2: clinic("c6_2", "C2", "Clinic 2: service scope, workforce and routes to the UNA numbers", [
      ["Delivering the services (the core and adaptable elements agreed in Session 3)", [
        "How are the core elements delivered in the same way everywhere?",
        "How are the adaptable elements chosen locally, who agrees to the choice, and how is it recorded?",
        "How do the supplies, equipment and medicines each service needs reach the people served?",
        "How do people move from PK to the rest of the health system (primary care, medicines, referral) so that care continues?"]],
      ["Workforce", [
        "Who delivers the services, and does the direction need a different scope of work or a new cadre?",
        "How are the people who deliver them paid, by whom and from which budget?",
        "Who supervises and trains them, how often, and how is their work recognized?"]],
      ["Routes to the UNA numbers", [
        "How will regions reach their minimum numbers through each route (building on Session 4)?",
        "What does each route need that it does not have now?",
        "How is progress tracked, and what happens when a region falls behind?"]]]),
    c6_3: clinic("c6_3", "C3", "Clinic 3: financing, governance and transition", [
      ["Financing", [
        "Which funding sources pay for what?",
        "Is any of the funding weighted by need, and how?",
        "How do funds reach the level where services are delivered, and how are they accounted for?"]],
      ["Governance", [
        "Which office owns what at each level (national, regional, province or city, municipality, barangay)?",
        "Who decides, who implements and who monitors, and how do the offices and partners involved coordinate?",
        "What does each level commit to, and in what form?"]],
      ["Transition", [
        "How does the move from the current PK to the new PK work, and in what steps?",
        "What continues unchanged in the meantime so that services are not interrupted, and what stops?",
        "What must be in place by the start of 2027?"]]]),
    s6_merge: { title: "Agreed components (Session 6 plenary)", kind: "sheet", sheets: ["ROOM"], staffOnly: true, view: "merge6",
      intro: "After each clinic presents, staff type what the plenary agreed in the last two columns. The agreed components are what Session 7 builds indicators on." },

    c7_1: { title: "Clinic 1: indicators", kind: "sheet", sheets: ["C1"], clinic: true, view: "ind", from: "C1", intro: IND_INTRO },
    c7_2: { title: "Clinic 2: indicators", kind: "sheet", sheets: ["C2"], clinic: true, view: "ind", from: "C2", intro: IND_INTRO },
    c7_3: { title: "Clinic 3: indicators", kind: "sheet", sheets: ["C3"], clinic: true, view: "ind", from: "C3", intro: IND_INTRO },
    ref_ind: { title: "Pre-work indicators (reference)", kind: "sheet", sheets: ["ROOM"], staffOnly: true, view: "refind", importable: true,
      intro: "Shown on the Session 7 slide as a reference only. Staff enter or paste the list before Day 2.",
      sections: [
        { id: "p", title: "What the pre-work said would be most useful (Table 44)", type: "rows", add: "Add a result", cols: [{ id: "text", label: "Result" }, { id: "n", label: "Count" }] },
        { id: "w", title: "Also suggested in the written answers (Table 45)", type: "rows", add: "Add a theme", cols: [{ id: "text", label: "Theme" }, { id: "n", label: "Count" }] }] },

    partner_d7: { title: "Partner alignment matrix (D7)", kind: "sheet", sheets: TABLES,
      intro: "Partners and DOH offices each fill in a row. The matrix goes to BIHC as an input to the partner resource plan.",
      sections: [{ id: "p", title: "Partners and offices", type: "rows", add: "Add a partner or office", cols: [
        { id: "partner", label: "Partner or office" }, { id: "current", label: "Current support relevant to PK" },
        { id: "pillar", label: "UNA pillar and sub-component" },
        { id: "fit", label: "Fit with the agreed direction", type: "select", options: ["High", "Partial", "Low"] },
        { id: "realign", label: "Possible realignment, next 16 months" },
        { id: "gap", label: "Gap the Department should seek support for" }] }] },

    evaluation: { title: "Evaluation (D8)", kind: "link" },

    // ---------- staff registers used on both days ----------
    results_contest: { title: "Results and contest sheet (D12)", kind: "sheet", sheets: ["ROOM"], staffOnly: true,
      intro: "One row per topic. An uncontested result is carried; a contested one is settled by show of hands or by a quick vote.",
      sections: [{ id: "t", title: "Topics", type: "rows", add: "Add a topic", cols: [
        { id: "topic", label: "Topic" }, { id: "items", label: "Items" }, { id: "result", label: "Result (counts, by combined group)" },
        { id: "flag", label: "Flag before the session" }, { id: "contest", label: "Contested by (group only) and reason" },
        { id: "outcome", label: "Outcome", type: "select", options: ["Carried", "Amended", "Overturned"] }, { id: "vote", label: "Vote" }] }] },
    design_questions: { title: "Design-questions register", kind: "sheet", sheets: ["ROOM"], staffOnly: true,
      intro: "Anything unsettled (for example elements D9 could not classify) goes here for the Day 2 clinics.",
      sections: [{ id: "q", title: "Register", type: "rows", add: "Add a question", cols: [
        { id: "question", label: "Design question or unsettled element" }, { id: "from", label: "Raised in (session, table)" },
        { id: "clinic", label: "Clinic", type: "select", options: ["Clinic 1", "Clinic 2", "Clinic 3", "Not assigned"] },
        { id: "status", label: "Status", type: "select", options: ["Open", "Answered in a clinic", "Parked"] }] }] }
  };

  // The slides, in running order. No times: the workshop manages time as it goes.
  //   acts: the activities this slide opens on phones (forms and table or clinic sheets).
  //   shown: staff sheets this slide puts on the room screen and phones (read-only for participants).
  //   reveal: staff sheets that phones need to read on this slide (made readable on arrival).
  //   optional: Next and Previous skip it; staff start it from the slide list.
  var SLIDES = [
    { day: "Day 1 · Wednesday 25 November", slides: [
      { id: "s0_1", session: "Session 0: where PK stands", title: "0.1 Your clarifying question", acts: ["s0_clarify"] },
      { id: "s0_2", session: "Session 0: where PK stands", title: "0.2 A result you would question", acts: ["s0_question"] },
      { id: "s1_1", session: "Session 1: the eight questions and the weights", title: "1.1 Accept the weights?", acts: ["s1_weights"] },
      { id: "s1_2", session: "Session 1: the eight questions and the weights", title: "1.2 Vote on the weights (if contested)", acts: ["s1_vote"], optional: true },
      { id: "s2_1", session: "Session 2: one direction", title: "2.1 The starting elements", shown: ["s2_start"] },
      { id: "s2_2", session: "Session 2: one direction", title: "2.2 Choose your table's elements", acts: ["s2_choose"], reveal: ["s2_start"] },
      { id: "s2_3", session: "Session 2: one direction", title: "2.3 Test your direction", acts: ["s2_test"], reveal: ["s2_start"] },
      { id: "s2_m", session: "Session 2: one direction", title: "Merge: the one direction", shown: ["s2_merge"], reveal: ["s2_start", "s2_choose"] },
      { id: "s2_4", session: "Session 2: one direction", title: "2.4 Agreement check (only if needed)", acts: ["s2_agree"], optional: true, reveal: ["s2_merge"] },
      { id: "s3_1", session: "Session 3: models, core and adaptable elements", title: "3.1 What can be carried over", acts: ["s3_carry"] },
      { id: "s3_2", session: "Session 3: models, core and adaptable elements", title: "3.2 Elements the pre-work settles", acts: ["s3_settled"] },
      { id: "s3_3", session: "Session 3: models, core and adaptable elements", title: "3.3 Models and core or adaptable elements (D9)", acts: ["d9_models"] },
      { id: "s4_1", session: "Session 4: reaching the UNA numbers", title: "4.1 Your region's routes (D10)", acts: ["d10"] }
    ] },
    { day: "Day 2 · Thursday 26 November", slides: [
      { id: "s5_1", session: "Session 5: recap of Day 1", title: "Recap in plenary (show of hands)", acts: [] },
      { id: "s6_1", session: "Session 6: how the direction will work", title: "6.1 The clinics", acts: ["c6_1", "c6_2", "c6_3"], reveal: ["s2_merge"] },
      { id: "s6_m", session: "Session 6: how the direction will work", title: "6.2 Agreed components (plenary)", shown: ["s6_merge"], reveal: ["c6_1", "c6_2", "c6_3"] },
      { id: "s7_1", session: "Session 7: indicators", title: "7.1 Indicators for the agreed components", acts: ["c7_1", "c7_2", "c7_3"], reveal: ["s6_merge", "ref_ind"] },
      { id: "s8_1", session: "Session 8: partner alignment", title: "8.1 Partner alignment matrix (D7)", acts: ["partner_d7"] },
      { id: "close", session: "Closing", title: "Evaluation", acts: ["evaluation"] }
    ] }
  ];
  // staff sheets kept on the Registers tab
  var REGISTERS = ["s2_start", "ref_ind", "s2_merge", "s6_merge", "results_contest", "design_questions"];

  // D11, the one-page table guide, shown on every phone
  var GUIDE = [
    ["Roles", "The chair is a regional participant who is not the most senior at the table; the chair keeps time and makes sure every voice is heard. The rapporteur usually types the table's answers, on any phone at the table. One of the four BLHSD staff anchors each table and acts as the resource person."],
    ["What is on your phone", "Your phone shows only the slide that is on the screen. Each slide says whether to answer on your own or as a table or clinic."],
    ["Recording", "Write a one-line reason where asked. Record disagreements and minority positions as they are said; do not average them away."],
    ["Counts and confidentiality", "The pre-work results are counts for combined groups. Do not try to work out who answered what."]
  ];

  return { activities: ACTIVITIES, slides: SLIDES, registers: REGISTERS, crit: CRIT, regions: REGIONS, nat: NAT, routes: ROUTES, levels: LEVELS, guide: GUIDE };
})();
