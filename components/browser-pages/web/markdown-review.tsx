import "./styles.css";
import "./markdown/styles.css";

import { MarkdownReview } from "./markdown/app";
import { mount } from "./mount";

mount("markdown-review", (page) => <MarkdownReview page={page} />);
