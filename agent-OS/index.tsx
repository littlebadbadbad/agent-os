import "../agent-UI/styles/global.scss";
import { initSessions, streamAgent } from "../agent-UI/agents";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

initSessions().then(() => {
  streamAgent.render();
});
