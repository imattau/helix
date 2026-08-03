import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HelixProvider } from "./backend/HelixProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HelixProvider>
      <App />
    </HelixProvider>
  </React.StrictMode>,
);
