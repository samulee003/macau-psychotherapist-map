# 2026-07-01 Mobile Bottom Sheet Layout Design

## Overview
This design updates the mobile layout of the Macau Psychotherapist Map to feature a modern, mobile-friendly **Bottom Sheet** UI pattern (similar to Apple Maps and Google Maps). It replaces the side-drawer layout on mobile devices with a overlay panel at the bottom of the screen.

## User Intent & Requirements
* **Goal**: Provide a premium and modern mobile map user experience.
* **Layout**:
  - The map is full-screen.
  - The control panel (sidebar) sits as a bottom sheet.
  - States for the bottom sheet:
    - **Minimized**: Height ~140px, showing only the search/chatbot inputs and category chips.
    - **Expanded**: Height ~70vh, showing the entire sidebar including therapist lists, footer, etc.
  - Detailed drawer is also a bottom sheet. It opens on top of the minimized sidebar, allowing users to focus on map markers and detail descriptions.

## Proposed Changes

### CSS Layout (`src/styles.css`)
* Add `.sidebar__handle` style.
* Use CSS transition on `transform` for smooth performance.
* Reposition AMap controls to prevent overlaps.

### JavaScript Logic (`src/main.js`, `src/detail.js`)
* Bind tap/click handlers to the sidebar handle.
* Minimize the sidebar automatically when a marker or list item is clicked.
* Toggle detail drawer z-index to overlay sidebar.

## Verification
* Run end-to-end tests to verify that keyword filtering, chatbot, list clicks, and category filters still work on both mobile and desktop.
