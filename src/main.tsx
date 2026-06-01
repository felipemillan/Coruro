import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// NOTE: React.StrictMode is intentionally NOT used here. @hello-pangea/dnd
// (and the upstream react-beautiful-dnd) relies on identity-stable effects and
// breaks under StrictMode's intentional double-invocation in development —
// Droppables fail to register and drags become unusable. Disabling StrictMode
// is the maintainer-recommended workaround for this library.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
