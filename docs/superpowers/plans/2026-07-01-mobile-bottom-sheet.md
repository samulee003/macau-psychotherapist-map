# Mobile Bottom Sheet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Refactor the mobile view of the map application to use a premium bottom sheet layout, ensuring the map is 100% full screen and the controls sit in a clean sliding drawer overlay.

**Architecture**: 
- Reorganize CSS media queries (`max-width: 768px`) to make `.sidebar` absolute positioned at the bottom, with standard sheet transitions.
- Bind mouse/touch events in JS to toggle the sheet state between minimized (header only) and expanded.
- Hook into marker/list click events to minimize the sidebar and expand the clinic details drawer.

**Tech Stack**: Vanilla CSS, Vanilla JavaScript, ES Modules, AMap JS API 2.0.

---

## Proposed Changes

### Task 1: CSS Layout Refactoring (`src/styles.css`)

**Files**:
- Modify: [src/styles.css](file:///Users/samulee003/Downloads/macau-psychotherapist-map/src/styles.css)

- [ ] **Step 1: Implement Bottom Sheet style in Media Query**
  Update the `@media (max-width: 768px)` media query block to convert the sidebar into a sliding bottom sheet:
  ```css
  @media (max-width: 768px) {
    .sidebar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      width: 100%;
      height: 70vh;
      max-width: 100%;
      margin-left: 0;
      transform: translateY(calc(70vh - 140px)); /* Minimized state: show only top 140px */
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-right: none;
      border-top: 1px solid var(--color-border);
      box-shadow: 0 -8px 32px rgba(15, 23, 42, 0.12);
      z-index: 1000;
    }
    
    .sidebar.is-expanded {
      transform: translateY(0);
    }

    .sidebar.is-collapsed {
      transform: translateY(100%);
    }

    .sidebar__resizer {
      display: none !important;
    }

    .sidebar__handle {
      display: block;
      width: 40px;
      height: 4px;
      background: #cbd5e1;
      border-radius: 2px;
      margin: 8px auto 0;
      cursor: pointer;
    }
  }
  ```

- [ ] **Step 2: Adjust detail drawer layout for mobile**
  Verify the `.drawer` bottom sheet has higher z-index to overlay the sidebar bottom sheet cleanly:
  ```css
  @media (max-width: 768px) {
    .drawer {
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      width: 100%;
      max-height: 75vh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      transform: translateY(0);
      border: none;
      border-top: 1px solid var(--color-border);
      box-shadow: 0 -8px 32px rgba(15, 23, 42, 0.15);
      z-index: 1100; /* Above sidebar */
    }
  }
  ```

---

### Task 2: JavaScript DOM Binding & Interaction (`src/main.js`, `src/detail.js`)

**Files**:
- Modify: [src/main.js](file:///Users/samulee003/Downloads/macau-psychotherapist-map/src/main.js)
- Modify: [src/detail.js](file:///Users/samulee003/Downloads/macau-psychotherapist-map/src/detail.js)

- [ ] **Step 1: Add HTML handle structure to sidebar**
  Inject a drag handle element at the top of the sidebar inside `index.html`.
  Wait, let's inject it programmatically or write it in `index.html`. We will do it in `index.html` as:
  ```html
  <aside id="sidebar" class="sidebar">
    <div class="sidebar__handle" id="sidebar-handle"></div>
    ...
  ```

- [ ] **Step 2: Add JS toggle handlers**
  In `src/main.js` under `bindSidebarToggle()`, support expanding the bottom sheet when clicking the handle or the header:
  ```javascript
  const handle = document.getElementById('sidebar-handle');
  handle?.addEventListener('click', () => {
    sidebar.classList.toggle('is-expanded');
  });
  ```

- [ ] **Step 3: Minimize sidebar when marker or list item is clicked**
  In `src/main.js` location click/marker click callbacks:
  ```javascript
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('is-expanded'); // Collapses back to minimized state
  }
  ```

---

### Task 3: Verification & Build

**Files**:
- Run: `npm run build`
- Run: `.venv/bin/python3 scratch/e2e_live_test.py`

- [ ] **Step 1: Compile assets**
  Run compilation to verify zero syntax errors.
- [ ] **Step 2: Run End-to-End Tests**
  Verify keyword search, filter tags, list items, and detail drawer function perfectly.
