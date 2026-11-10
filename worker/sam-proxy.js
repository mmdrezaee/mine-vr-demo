// Sam proxy: a Cloudflare Worker that lets the Pit Shift Trainer talk to Claude
// without putting an API key in the web page. The key stays in this Worker as a secret.
//
// Security choices:
// - Only pages from ALLOWED_ORIGINS may call it (browsers send Origin; this blocks other websites).
// - The system prompt and the procedure live here, not in the page, so the proxy
//   cannot be used as a general-purpose Claude endpoint.
// - Input size and conversation length are capped, and answers are short (max_tokens).
// Note: Origin can be faked by scripts outside a browser. For a public deployment,
// add Cloudflare rate limiting or Turnstile in front of this Worker.

const SAM_RULES = "You are Sam, a friendly, experienced shift trainer at an open-pit mine. You are talking out loud to a trainee inside a VR training simulation at the pit lookout above a haul road.\nReply in plain spoken English: one to three short sentences, at most 60 words, no lists, no markdown, no emoji.\nGround every safety rule in the PROCEDURE below and name the rule number (for example \"Rule 4.2\") when you use one. If the procedure does not cover the question, say so briefly and suggest asking the site supervisor. Never invent site-specific numbers or rules.\nThe procedure is a fictional sample written for this demo; say so if asked whether it is real.\nUse the CURRENT SITUATION to personalize: refer to the trainee's weakest area, last situation or score when it helps. Do not reveal a hazard that is currently active unless \"hintAllowed\" is true.\nBe encouraging and direct. Safety comes first. If the trainee asks about something unrelated to mining safety or the training, answer in one sentence and steer back to the shift.";

const PROCEDURE = "4 HAUL ROAD OPERATIONS\n4.1 General. This section applies to all persons, mobile equipment and light vehicles operating on or adjacent to haul roads within the active pit, including contractors and visitors under escort. Where this section conflicts with a task-specific procedure, the more stringent requirement applies.\n4.2 Haul truck blind zones. Persons on foot shall not enter the area within 10 m of the front, rear or either side of a haul truck unless positive two-way radio communication has been established with the operator and the operator has acknowledged the person’s location. Where visibility is reduced by dust, darkness or weather, the exclusion distance shall be increased in accordance with Section 7.4.\n4.3 Speed limits. Loaded and empty haul trucks shall not exceed the posted limit of 30 km/h on Bench 1240 haul roads. Limits on ramps are set out in Appendix C, Table C-3, and may be reduced by the Shift Supervisor when road conditions require it.\n4.4 Overtaking. Overtaking of haul trucks is prohibited except where expressly authorised by Dispatch and where the overtaking vehicle has an unobstructed view of at least 150 m of roadway.\n4.5 Light vehicles. Every light vehicle entering an active haul road shall display a high-visibility flag mounted on a whip at least 3 m above ground and an operating amber beacon, and shall obtain clearance from Dispatch before entry (Form LV-11).\n4.6 Intersections. Right of way at intersections is set out in the Site Traffic Management Plan, Figure 3. Light vehicles shall yield to haul trucks at all times.\n4.7 Berms. Berms shall be maintained at not less than mid-axle height of the largest vehicle using the road. Damage to a berm shall be reported immediately and the area barricaded until repaired and inspected by a competent person.\n5 EXCAVATOR AND SHOVEL OPERATIONS\n5.1 Swing radius. No person shall enter the swing radius of an operating excavator or shovel. The swing radius shall be delineated on the ground and the operator shall stop all movement if a person is seen within it.\n5.2 Loading. Trucks shall be positioned for loading only on the operator’s signal. The truck operator shall remain in the cab with the park brake applied throughout loading.\n5.3 Pre-start checks. The operator shall complete the pre-start checklist (Form EX-02) at the start of each shift and record defects in the equipment log. Equipment with a defect classed as critical in Appendix F shall not be operated.\n5.4 Refuelling. Refuelling in the pit shall be carried out only at designated locations and only with the engine stopped, in accordance with the Fuel Handling Standard (MS-FH-001).\n6 COMMUNICATION\n6.1 Radio channels. Channel 2 is reserved for haul road traffic. Persons on foot within the pit shall carry a radio set to Channel 2 and shall announce their location when entering or leaving a work area.\n6.2 Emergencies. In an emergency the words “Emergency, emergency, emergency” shall be used to clear the channel. All other traffic shall stop until Dispatch confirms the channel is clear.\n7 VISIBILITY\n7.1 Dust. Water trucks shall be scheduled so that visible dust does not reduce sight distance below 150 m on any haul road. Where this cannot be achieved, speed limits shall be reduced by 10 km/h.\n7.2 Night work. Lighting towers shall be positioned so that all intersections, loading areas and dump points are illuminated to the levels in Table 7-1.";

const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "https://mmdrezaee.github.io").split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
    if (!allowed.includes(origin)) return json({ error: "forbidden_origin" }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, cors); }
    const raw = Array.isArray(body.messages) ? body.messages.slice(-7) : [];
    const messages = raw
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "bad_messages" }, 400, cors);
    const state = JSON.stringify(body.state || {}).slice(0, 3000);

    const system = SAM_RULES + "\n\nPROCEDURE (MP-HR-004, fictional sample):\n" + PROCEDURE + "\n\nCURRENT SITUATION:\n" + state;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODEL || "claude-sonnet-5-5", max_tokens: 220, system, messages }),
    });
    let data = null;
    try { data = await r.json(); } catch { /* ignore */ }
    if (!r.ok) return json({ error: (data && data.error && data.error.type) || "upstream_error" }, 502, cors);
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return json({ text }, 200, cors);
  },
};
