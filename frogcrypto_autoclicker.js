// Function to click the button
let autoClickButton = () => {
    // Find all buttons on the page
    const buttons = document.querySelectorAll('button');
    
    // Click any button that matches our criteria
    buttons.forEach(button => {
      // For people who add 
      if (button.textContent.includes('Accept')) {
        if (!button.disabled) {
        button.click();
        console.log('Clicked button:', button.textContent);
        }
      }
      // for search swamp + search capital, etc (ie NOT into the void)
      if (button.textContent.includes('search')) {
        if (!button.disabled) {
          button.click();
          console.log('Clicked button:', button.textContent);
        } else {
          console.log('Button is disabled, waiting...');
        }
      }
    });
  };
  
  // Run the click function every 15 seconds
  let clickInterval = setInterval(autoClickButton, 15000);
  
  // Function to stop the auto-clicker
  let stopClicking = () => {
    clearInterval(clickInterval);
    console.log('Stopped auto-clicking');
  };
  
  // Log instructions
  console.log('Auto-clicker started. Type stopClicking() to stop');
