// Respect explicit image links instead of nesting a lightbox link inside them.
Even.fancybox = function() {
  if (!$.fancybox) {
    return;
  }

  $('.post-content img').filter(function() {
    return $(this).closest('a').length === 0;
  }).each(function() {
    $(this).wrap($('<a>', {
      class: 'fancybox',
      href: this.src,
      'data-fancybox': 'gallery',
      'data-caption': this.title,
    }));
  });

  $('.fancybox').fancybox({
    selector: '.fancybox',
    protect: true,
  });
};

$(document).ready(function () {
  Even.backToTop();
  Even.mobileNavbar();
  Even.toc();
  Even.fancybox();
});

Even.responsiveTable();
Even.flowchart();
Even.sequence();

if (window.hljs) {
  hljs.initHighlighting();
  Even.highlight();
} else {
  Even.chroma();
}
