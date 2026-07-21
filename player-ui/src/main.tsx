import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { PlayerApp } from "./player-app.js";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Player Interface root is missing.");

createRoot(root).render(
  <BrowserRouter>
    <PlayerApp />
  </BrowserRouter>,
);
