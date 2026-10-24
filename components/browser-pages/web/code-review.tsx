import "./styles.css";
import "./markdown/styles.css";

import { CodeReview } from "./app";
import { mount } from "./mount";

mount("code-review", (page) => <CodeReview page={page} />);
