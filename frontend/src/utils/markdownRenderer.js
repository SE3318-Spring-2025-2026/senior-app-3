/**
 * Simple markdown rendering utility for comment content
 * Handles: **bold**, *italic*, `inline code`, [links](url), and line breaks
 */

export const renderMarkdown = (text) => {
  if (!text) return '';

  let rendered = text;

  // Escape HTML special characters
  rendered = rendered
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert bold **text** to <strong>
  rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert italic *text* to <em>
  rendered = rendered.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Convert inline code `text` to <code>
  rendered = rendered.replace(/`(.*?)`/g, '<code>$1</code>');

  // Convert links [text](url)
  rendered = rendered.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Convert line breaks
  rendered = rendered.replace(/\n/g, '<br />');

  return rendered;
};

export default renderMarkdown;
