## file

The quest office and library use the backend API against fake Jira and Confluence. Agent Workplace never writes to Confluence.
Why: a fake that accepts a write would hide a production call the product does not make.
