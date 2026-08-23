function showToast(message) {
  try {
    // Create a unique toast element for each message
    const toastId = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    
    // Create toast container if it doesn't exist
    let container = document.getElementById('gm-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'gm-toast-container';
      container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    
    // Create individual toast
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.textContent = message || "Changes saved";
    toast.style.cssText = `
      background: rgba(34, 197, 94, 0.95);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 0.875rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      max-width: 300px;
      word-wrap: break-word;
      pointer-events: auto;
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    
    container.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
    
    // Remove toast after duration
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        
        // Clean up container if empty
        if (container.childNodes.length === 0) {
          if (container.parentNode) {
            container.parentNode.removeChild(container);
          }
        }
      }, 300);
    }, 3000); // Show for 3 seconds
    
  } catch (e) {
    console.error("Toast error:", e);
  }
}

