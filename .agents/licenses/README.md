# Third-party agent skills

`.claude/skills/` and `.agents/skills/` hold agent skills (one copy in `.agents/skills`, linked from `.claude/skills`) installed with
[`skills`](https://skills.sh) (`bunx skills add <repo> --skill '*' -a claude-code -a universal -y`); the exact
sources and hashes are in `skills-lock.json`. All are MIT-licensed; their licenses are kept here:

| Source | License | Skills |
|---|---|---|
| [expo/skills](https://github.com/expo/skills) | MIT — `expo-skills.LICENSE` | `expo-*`, `eas-*` |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | MIT — `Leonxlnx-taste-skill.LICENSE` | `design-taste-frontend` |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT — `emilkowalski-skills.LICENSE` | `animate*`, `animation-*`, `apple-design`, `ask-sonner`, `break-ui`, `choreograph`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `prototype`, `remove-animations`, `review-animations`, `write-swift` |

Update with `bunx skills update -p -y`.
