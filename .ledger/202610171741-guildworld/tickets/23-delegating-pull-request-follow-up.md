# 23: Delegating pull request follow-up

**What to build:** From a pull request, the operator asks the agent who built it to address the review, or asks the coordinator to get it reviewed. The request goes out as an ordinary instruction to that agent.

**Blocked by:** 13 Instructing an agent from the panel; 21 The forge shows pull requests

**Status:** done

- [x] Ask the builder sends a `talk` or `follow_up` to the agent linked by branch, naming the pull request.
- [x] When no agent is linked, only Ask the coordinator is offered.
- [x] A delegated request never writes to GitHub.
