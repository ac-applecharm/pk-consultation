"use strict";
/* The fixed activity list for the two days (Day 1 and Day 2, 25-26 November 2026).
   The PowerPoint is presented separately; this page only runs the activities.
   Built from the facilitation deck v20261109B (the tagged activity slides and their session footers).
   kind "form": answered on a phone. kind "link": opens an outside link. kind "sheet": a table or clinic sheet (built in a later step).
   To change the program, edit PROGRAM below (order, session names, times) or add an entry to ACTIVITIES. */
window.PK_AGENDA = (function () {
  var ABCD = [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]];
  var ACTIVITIES = {
    accept_contest: { title: "Accept or contest: Where PK stands", kind: "form", items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] }] },
    weights_choice: { title: "Weights: pre-work or equal", kind: "form", items: [
      { id: "weights", label: "Which weights do you prefer?", type: "single", options: [["prework", "Pre-work weights"], ["equal", "Equal weights"]] }] },
    accept_contest_option: { title: "Preference result: accept or contest", kind: "form", items: [
      { id: "answer", label: "Do you accept this result, or do you contest it?", type: "single", options: [["accept", "Accept"], ["contest", "Contest"]] },
      { id: "option", label: "If you contest, which option would you put forward instead?", type: "single", options: ABCD, showIf: { item: "answer", value: "contest" } }] },
    ballot_d3: { title: "Individual ballot (D3)", kind: "form", items: [
      { id: "first", label: "My preferred option is", type: "single", options: ABCD.concat([["Hybrid", "Hybrid"]]) },
      { id: "hybrid_text", label: "Describe your hybrid", type: "text", showIf: { item: "first", value: "Hybrid" } },
      { id: "second", label: "My second choice is", type: "single", options: ABCD.concat([["None", "None"]]) },
      { id: "no_support", label: "An option I could not support under any conditions (choose any, or none)", type: "multi", options: ABCD },
      { id: "no_support_because", label: "Because", type: "text", showIf: { item: "no_support", filled: true } },
      { id: "condition", label: "A condition under which my first choice would work", type: "text" }] },
    consent_d4: { title: "Consent level (D4)", kind: "form", items: [
      { id: "level", label: "My level of consent", type: "scale", options: [
        ["1", "Cannot support; alternative proposed"], ["2", "Serious reservations; conditions needed"], ["3", "Can live with it; concerns recorded"],
        ["4", "Support with minor concerns"], ["5", "Fully support"]] },
      { id: "reason", label: "My reason, condition or alternative (needed for level 1 or 2)", type: "text" }] },
    evaluation: { title: "Evaluation (D8)", kind: "link" },
    d9_models: { title: "D9 models matrix", kind: "sheet" },
    d2_score: { title: "D2 scoring", kind: "sheet" },
    d2_table: { title: "D2 table summary", kind: "sheet" },
    departures: { title: "Departures from the pre-work", kind: "sheet" },
    hybrid: { title: "Hybrid line", kind: "sheet" },
    regional_worksheet: { title: "Reaching-the-numbers worksheet (D10)", kind: "sheet" },
    correction: { title: "Corrections", kind: "sheet" },
    case_for_against: { title: "Case for and against the carried direction", kind: "sheet" },
    clinic_d5_1: { title: "Clinic 1 sheet (D5): targeting, eligibility and data", kind: "sheet" },
    clinic_d5_2: { title: "Clinic 2 sheet (D5): service scope, workforce and routes to the numbers", kind: "sheet" },
    clinic_d5_3: { title: "Clinic 3 sheet (D5): financing, governance and transition", kind: "sheet" },
    indicators_d6: { title: "Targets and indicators matrix (D6)", kind: "sheet" },
    gallery_walk: { title: "Gallery walk", kind: "sheet" },
    partner_d7: { title: "Partner alignment matrix (D7)", kind: "sheet" },
    action_register: { title: "Action register (read-out)", kind: "sheet" }
  };

  // Program order. Each block is one part of a session, with its time.
  var PROGRAM = [
    { day: "Day 1 · Wednesday 25 November", blocks: [
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
      { session: "Synthesis", name: "Corrections", time: "09:14–09:20", acts: ["correction"] },
      { session: "Session 5", name: "Case for and against", time: "09:25–09:40", acts: ["case_for_against"] },
      { session: "Session 5", name: "Consent round", time: "10:50–11:10", acts: ["consent_d4"] },
      { session: "Session 6", name: "Clinics", time: "12:40–13:25", acts: ["clinic_d5_1", "clinic_d5_2", "clinic_d5_3"] },
      { session: "Session 7", name: "Matrix work", time: "14:05–14:35", acts: ["indicators_d6"] },
      { session: "Session 7", name: "Harvest", time: "14:35–14:50", acts: ["gallery_walk"] },
      { session: "Session 8", name: "Partner matrix", time: "14:50–15:15", acts: ["partner_d7"] },
      { session: "Session 8", name: "Read-out", time: "15:15–15:25", acts: ["action_register"] },
      { session: "Session 9", name: "Evaluation", time: "15:40–15:50", acts: ["evaluation"] }
    ] }
  ];
  return { activities: ACTIVITIES, program: PROGRAM };
})();
