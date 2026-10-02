// Runs the timetable solver off the page thread.
import { solve } from "./schedule.js";

self.onmessage = (e) => {
  try { self.postMessage(solve(e.data)); }
  catch (err) { self.postMessage({ ok: false, schedules: [], reasons: [{ type: "nofit" }], error: String(err) }); }
};
