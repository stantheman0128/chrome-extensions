function removeGlasp() {
  document.querySelectorAll('.glasp-extension').forEach(el => el.remove());
}

// Run once on load
removeGlasp();

// Watch for dynamically injected elements
const observer = new MutationObserver(removeGlasp);
observer.observe(document.documentElement, { childList: true, subtree: true });
