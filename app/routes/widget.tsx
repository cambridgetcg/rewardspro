export async function loader() {
  const widgetCode = `
    // Create widget
    const widget = document.createElement('div');
    widget.innerHTML = \`
      <div style="
        background: #6366f1;
        color: white;
        padding: 24px;
        border-radius: 12px;
        text-align: center;
        font-family: system-ui, sans-serif;
        margin: 16px;
      ">
        <h2 style="margin: 0 0 8px 0;">Hello World! 👋</h2>
        <p style="margin: 0; opacity: 0.9;">This widget loaded at: \${new Date().toLocaleTimeString()}</p>
      </div>
    \`;
    
    // Insert widget
    const container = document.getElementById('my-widget');
    if (container) {
      container.appendChild(widget);
    }
  `;
  
  return new Response(widgetCode, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache'
    }
  });
}