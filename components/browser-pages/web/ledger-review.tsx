import "./styles.css";
import "./markdown/styles.css";
import "./ledger/styles.css";

import { LedgerReview } from "./ledger/app";
import { mount } from "./mount";

mount("ledger-review", (page) => <LedgerReview page={page} />);
