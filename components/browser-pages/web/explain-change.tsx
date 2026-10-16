import "./styles.css";
import "./markdown/styles.css";
import "./explain/styles.css";

import { ExplainChange } from "./explain/app";
import { mount } from "./mount";

mount("explain-change", (page) => <ExplainChange page={page} />);
