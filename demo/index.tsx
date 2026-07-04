import { createRoot } from "react-dom/client";
import DevOpsApp from "./components/DevOpsApp";
import { initSessions, streamAgent } from "../agent-UI/agents";
import { devopsToolset } from "./tools/devopsToolset";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(<DevOpsApp />);

initSessions().then(() => {
  streamAgent.registerToolSet(devopsToolset);
  streamAgent.render();
});
