# Cholesterol Food Tracker, Functional Specification

Defines **what** the app does. `tech-spec.md` defines **how** it is built.

---

## 1. Product overview

**Problem.** A person with elevated LDL cholesterol wants to know, day by day, whether what they eat is helping or hurting. Today this lives in a spreadsheet that takes several manual steps per meal, which discourages consistent logging.

**Solution.** A mobile-first web app where the user logs a dish in a few seconds, ideally from a photo. The app identifies the dish, scores its likely impact on LDL, explains the score, and charts it over time against a personal goal.

**Design principles**

1. **Logging must be fast.** Photo, confirm, done, in a few seconds.
2. **Every score is explained.** The user always sees why a dish scored the way it did.
3. **The score is not negotiable.** The user describes the food; the app decides the score. Users cannot edit a score or its justification, because self-serving adjustments would destroy the value of the tracking.
4. **Less is more.** Anything not needed to log a dish, understand its score, or see the trend does not belong in the app.

**Non-goals.** Calorie or macro tracking, weight management, portion or quantity tracking, meal types, notes, tags, recipes, meal planning, barcode scanning, wearables, social features.

---

## 2. Users and access

| Role | Capabilities |
|---|---|
| **User** | Create, view, edit, delete their own entries. Their own dashboard and goal. |
| **Administrator** | Manage the list of authorized users. Edit the AI prompts. **Cannot see any user's entries, scores or dashboard.** |

- **Login is Google only.** No local passwords, no sign-up form.
- **Access is by invitation.** The administrator maintains an allowlist of email addresses. A Google account not on it is refused with a clear "not authorized" message.
- The account is provisioned on first successful login. Blocking or removing an email blocks further access immediately, including sessions already open.
- **Data isolation is absolute.** No user, including the administrator, can see another person's data. Deleting a user destroys their entries.

### 2.1 Local debug mode

- Controlled by a single configuration flag, off by default, honored **only in a local environment**. In any deployed environment it is ignored and Google login always applies, even if the flag is set.
- With debug mode on, the app skips authentication and starts a session as a fixed local debug user: no login screen, no allowlist check. Configuration can also grant that user administrator capabilities, so the admin area is testable without a second account.
- The debug user is an ordinary user, subject to every rule in this specification. A persistent visual indicator makes debug mode obvious. Nothing else changes.

---

## 3. Core concepts

### 3.1 Food Entry

The only record in the application. One entry is one dish eaten on one date.

| Field | Type | Required | User-editable | Notes |
|---|---|---|---|---|
| `date` | date | yes | **yes** | Defaults to today in the user's local timezone. Any past date allowed; future dates rejected. |
| `description` | text | yes | **yes** | The only input the AI scores. The dish name when well known ("Tagliatelle with pesto"), otherwise the main ingredients ("Grilled chicken, white rice, steamed broccoli, olive oil"). Max 200 characters. |
| `is_homemade` | boolean | yes | **yes** | True when prepared at home. A checkbox, defaults to true. Given to the AI as context, since bought food often hides fats that are not visible or named. |
| `score` | integer -5..+5 | yes | no | LDL impact score. See section 4. |
| `rationale` | text | yes | no | Why it scored what it scored, naming specific ingredients. 1 to 3 sentences. |
| `positive_factors` | list of `{label, reason}` | no | no | Ingredients or preparations that improved the score. |
| `negative_factors` | list of `{label, reason}` | no | no | Ingredients or preparations that worsened the score. |
There is no image field. A photo is input to the analysis and nothing else: it is shown while the Log flow is open and discarded when the flow ends.

Deliberately minimal: **what it was, when, whether it was homemade, what it scored.**

### 3.2 Daily summary (derived, never stored)

For any date: the number of entries and the arithmetic mean of their scores.

### 3.3 User settings

| Setting | Default | Notes |
|---|---|---|
| `daily_average_target` | +1.0 | The goal. The daily average should be at or above this value. Adjustable -2.0 to +5.0 in steps of 0.5. |
| `min_entries_for_valid_day` | 2 | A day with fewer entries is shown as *incomplete* rather than pass or fail, so one logged snack does not distort the record. Range 1 to 5. |

These are the only user-configurable settings.

### 3.4 AI prompts (administrator-owned)

The instructions the AI follows are **editable content, not hard-coded logic**, so scoring can be tuned without a code change.

| Prompt | Purpose |
|---|---|
| `image_analysis_prompt` | How to read a photo into a food description. |
| `scoring_prompt` | How a description becomes a score, a rationale, and the factor lists. Contains the rubric in section 4. |

Both are edited as plain text in the administration area. A change affects future analyses only; existing entries keep their scores. The previous version of each prompt is retained so a bad edit can be reverted in one action.

---

## 4. The scoring model

A starting rubric, written so the rules are unambiguous. It lives inside `scoring_prompt` and is expected to be tuned by the administrator.

### 4.1 Scale

Each dish gets a single **integer score from -5 to +5** for its expected effect on LDL cholesterol. The score is the whole classification; there are no categories layered on top.

| Score | Meaning |
|---|---|
| **+4 to +5** | Actively lowers LDL. Built on soluble fiber, plant protein or unsaturated fat, essentially no saturated fat. |
| **+1 to +3** | Neutral to beneficial. A sound everyday choice. |
| **0** | No meaningful effect either way. |
| **-1 to -3** | Raises LDL. Acceptable occasionally, not routinely. |
| **-4 to -5** | Strongly raises LDL. Built on saturated or trans fat. |

Scores render on a red-to-green scale (-5 deep red, 0 grey, +5 deep green), used consistently everywhere a score appears, and always shown with the signed number.

### 4.2 Rubric

Every dish starts at **0** and the modifiers below apply. Quantity is ignored: an ingredient counts if it is part of the dish.

**Negative modifiers (raise LDL)**

| Factor | Modifier |
|---|---|
| Partially hydrogenated oil or industrial trans fat (commercial baked goods, some margarines, packaged fried snacks) | -3 |
| A major saturated fat source is the base of the dish (fatty red meat, butter, cream, full-fat cheese, coconut oil, palm oil, lard) | -3 |
| A saturated fat source is present but secondary (cheese topping, cream sauce, cooking butter) | -2 |
| Processed meat (sausage, bacon, salami, ham, hot dog, pate) | -2 |
| Deep fried, or fried in abundant fat | -2 |
| Refined grains are the dominant carbohydrate (white bread, white rice, standard pasta, pastry) | -1 |
| Added sugar (sweet dish or sweetened drink) | -1 |
| *Proxy:* ultra-processed convenience product (ready meal, packaged snack, fast food) | -1 |
| *Proxy:* bought or restaurant food whose cooking fat cannot be identified from the description | -1 |

**Positive modifiers (lower LDL)**

| Factor | Modifier |
|---|---|
| Strong soluble fiber source (oats, barley, legumes, lentils, chickpeas, beans, psyllium) | +2 |
| The primary fat is unsaturated (olive oil, avocado, nuts, seeds) | +2 |
| Fatty fish rich in omega-3 (salmon, sardines, mackerel, anchovies, trout) | +1 |
| Moderate soluble fiber source (apple, pear, citrus, carrot, Brussels sprouts, flaxseed, aubergine) | +1 |
| Soy protein is a main component (tofu, tempeh, edamame, soy milk) | +1 |
| Nuts or seeds are a real component, not a garnish | +1 |
| Whole grains are the dominant carbohydrate (whole wheat, brown rice, quinoa, oats, whole rye) | +1 |
| Vegetables or fruit are a substantial part of the dish | +1 |
| Plant sterol or stanol fortified product | +1 |
| The main protein is lean (skinless poultry, white fish, shellfish, egg white, legumes) | +1 |

**Rules applied to the result, in order**

1. The two *proxy* penalties contribute **at most -1 in total**, because both stand in for the same unknown and must not stack into a verdict of their own.
2. If the dish contains industrial trans fat, the final score is capped at **-2**.
3. A dish built only on vegetables, fruit, legumes or whole grains, with no added saturated fat, scores **at least +1** — **unless rule 2 applied**, in which case the cap wins and this floor is skipped.
4. Clamp to -5..+5.

> **Why rule 3 is gated on rule 2.** A dish flagged as both whole-plant and
> trans-fat cannot be real, so the cap — the stronger, more specific signal —
> wins, and the collision is logged as a prompt-quality signal rather than
> silently resolved. Ungated, the floor would undo the cap and land such a dish
> at +1.
>
> **Why rule 1 acts before the clamp.** It operates on the running modifier
> total, not on the final -5..+5 value; applying it to a clamped score is off by
> one. This is why the AI contract in §6.3 returns the unclamped total and the
> app performs all four steps itself.

**Note on the homemade flag.** `is_homemade` is context for the AI. When a dish is marked as bought and the description does not identify the cooking fat, the AI assumes a less favorable preparation and says so in the rationale. This lives in `scoring_prompt` and can be softened or removed by the administrator.

Deliberately *not* penalized: dietary cholesterol as a general category, organ meat, egg yolks, and shellfish specifically. Saturated and trans fat are the dominant dietary drivers of LDL, and lean shellfish counts here as a lean protein.

### 4.3 Rationale

Every score comes with a plain-language explanation naming specific ingredients:

> "The cream sauce and the pancetta are both concentrated sources of saturated fat, the main dietary driver of LDL. The white pasta adds refined carbohydrate. The small amount of olive oil does not offset this."

Factors are returned as short tagged items so the UI can render colored chips: `+ Olive oil (unsaturated fat)`, `- Pancetta (saturated fat, processed meat)`.

The rationale is read-only and changes only when the entry is re-scored.

### 4.4 Aggregation

- **Daily average** is the arithmetic mean of that date's entry scores.
- A date with no entries is **not a zero**. It is "not logged" and is excluded from every average.
- A date with fewer entries than `min_entries_for_valid_day` is marked **incomplete** and excluded from goal pass or fail, though its entries still count in the score distribution.

---

## 5. Screens

Mobile-first. Five destinations in a persistent bottom navigation bar.

```
┌───────────────────────────────────────────────────────┐
│  [Today]   [History]   ( + Log )   [Dashboard]   [Me] │
└───────────────────────────────────────────────────────┘
```

| Screen | Purpose |
|---|---|
| **Today** | Default landing screen. Today's entries and the daily average against the target. |
| **Log** | The capture flow: photo or text, then review, then save or discard. |
| **History** | All entries, grouped by day, most recent first. |
| **Dashboard** | Score over time and score distribution against the goal. |
| **Me** | Goal, rubric reference, export, log out. |

**Administration** is a separate area, visible only to administrators, reachable from Me.

---

## 6. Functional requirements

### 6.1 Logging (primary path)

1. The user taps **Log** and chooses **Take photo** (opens the camera directly), **Choose from gallery**, or **Type it**.
2. A photo is compressed on the device and sent for analysis with a visible progress state. It is never stored — the description it produces is the record, and the review screen says so.
3. The app analyzes it and shows the **review screen**:
   - Proposed description (editable; on the typed path, the user's own text verbatim)
   - Homemade checkbox (editable, defaults to true)
   - Date (editable, defaults to today)
   - Score with its color, and the rationale (read-only)
   - Positive and negative factor chips (read-only)
4. **Save** creates the entry and returns to Today. **Discard** leaves nothing behind.

**Required behaviors**

- Editing the description or the homemade checkbox on the review screen requires a **re-score before saving**: the stale score stays visible and marked as stale, Save is blocked, and the re-score runs **on demand** when the user taps it. Scoring is never triggered by typing, by a blur or by a timer -- a keystroke must never be able to spend money.
- The score and rationale are never directly editable. If the user disagrees, the remedy is to correct the description.
- If the AI cannot identify food in the image, the app says so and asks the user to type a description. The photo stays on screen as a reference while they do.
- If the user *types* something that is not a dish ("asdf"), the entry is still scorable: it scores **0** with a rationale saying the text does not describe a recognisable dish. Asking someone who just typed to "type a description" would be a loop.
- If analysis fails, the user sees a clear error and a retry action. Nothing is ever saved without a score.
- A page refresh during review must not force a second paid analysis: the in-progress capture and its result survive a reload.

### 6.2 Quick check (deciding before eating)

The review screen **is** the quick check. Nothing is stored until **Save**, so a user standing in front of a menu or a plate photographs or types it, reads the score, the rationale and the chips, then **Discards** — or **Saves**, which creates an ordinary entry dated today. There is no separate mode, screen or record type, and an unsaved analysis appears nowhere in Today, History or the dashboard and affects no average.

### 6.3 AI analysis contract

Given an image and/or a description, plus the homemade flag, one analysis returns:

| Output | Rule |
|---|---|
| `description` | With an image: the common dish name if well known ("Tagliatelle with pesto", "Milanesa napolitana", "Chivito"), otherwise the main components separated by commas, ordered by prominence — never both a dish name and a full ingredient list. With typed text: the user's text, unchanged. |
| `score` | An integer -5..+5 from the rubric in section 4. |
| `rationale` | 1 to 3 sentences naming the ingredients that drove the score. |
| `positive_factors` / `negative_factors` | Short tagged items with a one-phrase reason each. |
| `modifier_sum` | The running total from the §4.2 rubric, **unclamped**, with both proxy penalties at full value and none of the four post-rules applied. This is the number the app does its arithmetic on. |
| `has_trans_fat`, `whole_plant_only`, `proxy_ultra_processed`, `proxy_unidentified_fat` | Booleans, so the app applies the §4.2 cap, floor and proxy cap itself rather than trusting the model's arithmetic. |
| `food_detected` | False when the image contains no identifiable food, which drives the 6.1 fallback. |

`score` is an **advisory cross-check only.** The app recomputes the stored
integer from `modifier_sum` and the booleans, so a model whose own arithmetic
disagrees cannot change what is stored. A large divergence between the two is
logged, because it is the clearest early signal that a prompt edit has gone
wrong.

**Constraints**

- Description and score come from a **single analysis**, so the photo path costs one model call, not two.
- When the user has typed a description, the image is **not sent**. The description is the only scored input (§3.1), so sending the photo would cost image tokens for a text-only answer and split the cache key for two identical descriptions.
- Cooking fats and sauces must be inferred where visible or implied; they often drive the score more than the visible main ingredient.
- Preparation method must be inferred where visible: fried versus grilled versus steamed, visible cheese, visible sauces.
- The same description scored twice must not differ by more than 1 point.
- Regional and Latin American dishes must be handled, not only North American or European ones.
- Behavior is defined by `image_analysis_prompt` and `scoring_prompt`, not by application code.

### 6.4 Viewing, editing, deleting

- Tapping an entry opens its **detail view**: description, homemade indicator, date, score with color, rationale, factor chips.
- **Edit** changes the date, the description and the homemade checkbox. Nothing else.
- Editing the description or the homemade checkbox **re-scores automatically**. The user sees the new result and can confirm or cancel, but cannot alter it. Changing only the date does not re-score.
- **Delete** requires a confirmation.

### 6.5 Today

- Header: today's date, the number of entries, and the **daily average** as a large signed number in its scale color, with a clear indicator of whether it meets `daily_average_target`.
- Entries in the order logged, each with the description, the signed score in its color, and an icon distinguishing homemade from bought.
- An empty state inviting the first log of the day. Incomplete days are labeled as such rather than shown as pass or fail.

### 6.6 History

- Reverse-chronological, grouped by day. Each day header shows the date, that day's average in its scale color, and the entry count.
- Text search across descriptions. Infinite scroll for long histories.

### 6.7 Dashboard

Answers one question first: **am I meeting my goal?**

- Period selector: last 7, 30, 90 days.
- **Average score for the period** against `daily_average_target`, with an unambiguous pass or miss state.
- **Days on target**, for example "18 of 26 **complete** days met your target".

The denominator of "days on target" is **complete days**: incomplete days are
excluded from goal pass or fail (§4.4, rule 9), so they cannot be counted in it.
They are reported separately — "3 days had fewer than 2 entries and are counted
as incomplete" — so the figure is not silently narrower than it looks.

The **period average** is the mean of the *complete days' daily averages*, not a
pooled mean of all entries, because the target is expressed as a daily average
and the two figures must be comparable. Pooling would weight a six-entry day
three times more heavily than a two-entry day.

| Chart | Type | Content |
|---|---|---|
| Score over time | Line | Daily average across the period, with a horizontal reference line at the target. |
| Score distribution | Bar | Number of dishes at each score from -5 to +5, bars colored on the score scale. |

Both must be readable on a phone in portrait, and must show "keep logging to see trends" rather than a broken chart when data is too thin.

### 6.8 Me

- Edit `daily_average_target` and `min_entries_for_valid_day`.
- View the scoring rubric as a reference page, so the user understands how scores are produced and why they cannot be edited.
- **Export** all entries to CSV: date, description, homemade flag, score, rationale.
- Log out. For administrators only, an entry point to the administration area.

### 6.9 Administration

Visible only to administrators. Contains no food data of any kind.

**Users**

- View the allowlist. Each row shows the email, whether it is blocked, and whether that person has ever signed in.
- Add an email. Block or unblock one, which takes effect immediately. Remove one.
- Delete a user and all their data. The confirmation states how many entries will be destroyed **without displaying any of their content**.
- No screen exposes descriptions, scores or dashboards.

**Prompts**

- View and edit `image_analysis_prompt` and `scoring_prompt` as plain text.
- Saving affects future analyses only; existing entries are never re-scored.
- **Revert** restores the previous saved version of that prompt in one action.

### 6.10 Cross-cutting

- **Mobile-first responsive design**, usable one-handed on a phone in portrait, with a usable desktop layout.
- **Dates are the user's local dates.** "Today" is today where the user is, not where the server is.
- **Image handling:** photos are resized and compressed on the device before being sent, to a few hundred kilobytes, never more than a few megabytes. The original full-resolution file is never sent. Compression must preserve enough detail for the AI to identify the dish.
- **Privacy:** food data is private to the user, never used for any purpose the user has not agreed to, and fully deleted when the user is deleted. Photos are never stored at all, so there is no photo archive to protect, export or leak.
- **Offline:** logging needs the model, so an offline state is shown clearly rather than queued.

---

## 7. Key business rules

1. Only allowlisted email addresses can log in, and only through Google.
2. `date` may never be in the user's future.
3. An entry always has a date, a description, a homemade flag and a score. Those four are the whole record; a photo is a way of producing the description, not part of it.
4. The score is always a single integer -5..+5. There is no separate category field.
5. The score, rationale and factor lists are read-only for the user, always. The AI proposes a score; **the application computes the stored integer** from the model's unclamped modifier total and its booleans (§4.2, §6.3).
6. Editing a description or a homemade flag always triggers a re-score. Editing only the date does not.
7. Portion and quantity are irrelevant. An ingredient is scored on presence, not amount.
8. Days with no entries are excluded from averages. They are not zeros.
9. Days with fewer than `min_entries_for_valid_day` entries are incomplete and excluded from goal pass or fail, and from the period average — but their entries still count in the score distribution.
10. An analysis is stored only when the user saves it.
11. Prompt changes apply to future analyses only, never retroactively.
12. Administrators manage users and prompts and can never view any user's food data.
13. Users can only ever read or write their own data.
14. Debug mode bypasses login only when the app runs locally. Off by default, always ignored in a deployed environment.

---

## 8. Acceptance criteria

**Access**

- [ ] An allowlisted person logs in with Google and stays logged in on their phone.
- [ ] A person not on the allowlist is refused with a clear message.
- [ ] Blocking or removing an email cuts off that person's access on their next request, not just their next login.
- [ ] No screen or request lets one user reach another user's data.

**Logging and scoring**

- [ ] A dish can be logged from a phone camera photo in a few seconds on the happy path, and from a gallery image or typed text.
- [ ] The photo path performs one analysis, not two.
- [ ] Editing the description or homemade checkbox on the review screen blocks Save until the user taps re-score; typing alone never calls the model.
- [ ] A photo the AI cannot identify falls back to typed description, with the photo still on screen.
- [ ] The date defaults to the user's local today, accepts any past date, and rejects future dates.
- [ ] Every saved entry has an integer score in -5..+5 and a non-empty rationale naming specific ingredients, plus distinct positive and negative factor items.
- [ ] **No interface anywhere in the app** lets a user type, pick or otherwise alter a score or rationale.
- [ ] The same description scored twice does not differ by more than 1 point.
- [ ] The trans-fat cap and the whole-plant floor hold even when the model's own score disagrees.
- [ ] The rubric is viewable in the app.

**Quick check**

- [ ] A dish can be analyzed by photo or text and discarded, leaving nothing in Today, History or the dashboard and changing no average.
- [ ] The same analysis can be saved as an entry in one action.
- [ ] Reloading the page mid-review does not trigger a second analysis.

**Managing records**

- [ ] Any entry can be viewed and deleted, and its date, description and homemade flag edited.
- [ ] Editing a description re-scores the entry and the user can cancel before it is committed.
- [ ] Deleting shows a confirmation.
- [ ] History is grouped by day with a per-day average, and descriptions can be searched.

**Dashboard**

- [ ] Period average against the target with an unambiguous pass or miss state, plus days on target.
- [ ] A score-over-time line chart with the target reference line, and a -5..+5 distribution bar chart.
- [ ] Both charts degrade gracefully with little or no data.

**Administration**

- [ ] An administrator can add, block, unblock and remove allowlisted emails.
- [ ] An administrator can delete a user and all their data without seeing any of its content.
- [ ] No administration screen displays any food description, score or dashboard.
- [ ] Both prompts can be edited and reverted, and saving one changes no existing entry's score.

**Quality**

- [ ] Fully usable one-handed on a phone in portrait.
- [ ] Photos are compressed on the device to a few hundred kilobytes before being sent, and no photo is stored anywhere after the Log flow ends.
- [ ] All entries export to CSV.

**Debug mode**

- [ ] Enabled locally, the app opens straight into Today as the debug user, with no Google login step and a visible indicator.
- [ ] Debug mode cannot be enabled in a deployed environment.
- [ ] Disabled, the normal Google login and allowlist checks apply unchanged.

---

## 9. Cost and latency

Two facts about running the app that shape the product, not just the bill:

- **Scoring latency is a product decision.** §1 asks for "photo, confirm, done,
  in a few seconds". Measured on this rubric, one uncached analysis takes ~17s at
  the model's default reasoning depth, ~11s at medium and ~6s at low, with no
  visible quality loss at low — the rubric is mechanical accumulation against an
  explicit list, not open-ended reasoning. The app therefore runs at low depth by
  default and exposes the setting. A repeat is a cache hit at ~0.1s.
- **A discarded analysis is not free.** It costs a model call even though it
  stores nothing, so the quick check in §6.2 is cheap in storage but not in
  money. The daily cap in the technical spec is what bounds it.
