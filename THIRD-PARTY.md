# Third-party code

No library is vendored. The quote builder keeps the native date input, the native hours range, and the existing CSS fade. Added JavaScript and CSS from libraries: 0 KB. The Content Security Policy is unchanged.

These candidates were reviewed and rejected. Versions and sizes are from the published packages at the time of that review.

## noUiSlider 15.8.1

- License: MIT
- Last published: June 2024
- Source: https://github.com/leongersen/noUiSlider
- Size: `nouislider.min.js` is 27.7 KB (about 10 KB gzip) plus about 4 KB of CSS
- Why it was rejected: it draws its own widget. The native range already snaps to whole hours, works from the keyboard, and can take the track, thumb, ticks, and value bubble in CSS. A second widget would sit on top of the required native input.

## Flatpickr 4.6.13

- License: MIT
- Last published: April 2022
- Source: https://github.com/flatpickr/flatpickr
- Size: about 14 KB gzip, plus CSS
- Why it was rejected: the release is old, the project has hundreds of open issues, and the calendar is a custom widget with weaker accessibility than the phone's own picker. The page already has `<input type="date">` and a written readout of the chosen day.

## Air Datepicker

- License: MIT
- Source: https://github.com/t1m0n/air-datepicker
- Size: about 13 KB gzip
- Why it was rejected: it is maintained more recently than Flatpickr, and it is still a custom calendar on top of a date field the browser already provides.

## Motion 12 / 14

- License: MIT
- Source: https://motion.dev
- Size: the `animate()` build that runs without a bundler is about 56 KB gzip. The smaller build is about 3 KB and needs a bundler.
- Why it was rejected: this site has no build step, and the step change is already a 220ms opacity transition with a reduced-motion override.
