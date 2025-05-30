(() => {
  console.log('[Uato Naext] API handler loaded in page context');

  // Function to get JWT token
  const getJwtToken = () => {
    try {
      return localStorage.getItem('uatoNaextToken');
    } catch (error) {
      console.error('[Uato Naext] Error getting JWT token:', error);
      return null;
    }
  };

  // Function to get user identity
  const getUserIdentity = () => {
    try {
      const identify = localStorage.getItem('identify');
      return identify ? JSON.parse(identify) : null;
    } catch (error) {
      console.error('[Uato Naext] Error getting user identity:', error);
      return null;
    }
  };

  // Function to intercept and reuse headers from existing requests
  let capturedHeaders = null;
  let lastCaptureTime = null;

  // Override fetch to capture headers from legitimate requests
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const options = args[1] || {};

    // Check if this is a request to the API we care about
    if (typeof request === 'string' && request.includes('fugw-edunext.fpt.edu.vn/fu')) {
      const headers = options.headers || {};

      // Capture headers if they contain the required fields
      if (headers['x-checksum'] && headers['x-hash'] && headers['x-date']) {
        capturedHeaders = {
          'x-checksum': headers['x-checksum'],
          'x-hash': headers['x-hash'],
          'x-date': headers['x-date'],
          'x-expiration': headers['x-expiration'],
        };
        lastCaptureTime = new Date();
        console.log('[Uato Naext] Captured headers from legitimate request:', {
          'x-date': headers['x-date'],
          'x-expiration': headers['x-expiration'],
        });
      }
    }

    return originalFetch.apply(this, args);
  };

  // Also override XMLHttpRequest to capture headers
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const headerCapture = {};

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name.toLowerCase().startsWith('x-')) {
      headerCapture[name.toLowerCase()] = value;

      // If we have all required headers, store them
      if (headerCapture['x-checksum'] && headerCapture['x-hash'] && headerCapture['x-date']) {
        capturedHeaders = {
          'x-checksum': headerCapture['x-checksum'],
          'x-hash': headerCapture['x-hash'],
          'x-date': headerCapture['x-date'],
          'x-expiration': headerCapture['x-expiration'],
        };
        lastCaptureTime = new Date();
        console.log('[Uato Naext] Captured headers from XHR request:', {
          'x-date': headerCapture['x-date'],
          'x-expiration': headerCapture['x-expiration'],
        });
      }
    }

    return originalXHRSetRequestHeader.call(this, name, value);
  };

  // Function to handle course redirection (simplified)
  const handleCourseRedirection = async courseId => {
    try {
      console.log(`[Uato Naext] Handling redirection for course ${courseId}`);

      // Create the direct URL without needing to fetch class information
      const redirectUrl = `https://fu-edunext.fpt.edu.vn/course?id=${courseId}`;

      console.log(`[Uato Naext] Redirecting directly to: ${redirectUrl}`);

      // Send the redirection info back to content script
      window.dispatchEvent(
        new CustomEvent('UATO_API_RESPONSE', {
          detail: {
            type: 'course_redirect',
            data: {
              courseId,
              redirectUrl,
            },
          },
        }),
      );
    } catch (error) {
      console.error('[Uato Naext] Error in course redirection:', error);

      window.dispatchEvent(
        new CustomEvent('UATO_API_RESPONSE', {
          detail: {
            type: 'course_redirect',
            error: error.message || 'Failed to create redirect URL',
          },
        }),
      );
    }
  };

  // Function to get subjects from localStorage
  const getSubjectsFromStorage = () => {
    try {
      const semester = localStorage.getItem('SELECTED_SEMESTER');
      if (!semester) {
        console.log('[Uato Naext] No semester found in localStorage');
        return null;
      }

      const key = 'COURSES-' + semester;
      const cached = localStorage.getItem(key);

      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.data) {
            console.log('[Uato Naext] Found subjects in localStorage:', parsed.data.length);
            return parsed.data;
          }
        } catch (e) {
          console.error('[Uato Naext] Error parsing subjects from localStorage:', e);
        }
      }

      return null;
    } catch (error) {
      console.error('[Uato Naext] Error accessing localStorage:', error);
      return null;
    }
  };

  // Function to handle the subjects request
  const handleSubjectsRequest = () => {
    const subjects = getSubjectsFromStorage();

    if (subjects) {
      window.dispatchEvent(
        new CustomEvent('UATO_API_RESPONSE', {
          detail: {
            type: 'subjects',
            data: subjects,
          },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent('UATO_API_RESPONSE', {
          detail: {
            type: 'subjects',
            error: 'Could not find subjects data in localStorage. Please refresh the university page first.',
          },
        }),
      );
    }
  };

  // Listen for fetch subjects request
  window.addEventListener('UATO_FETCH_SUBJECTS', () => {
    console.log('[Uato Naext] Received request to fetch subjects in page context');
    handleSubjectsRequest();
  });

  // Listen for course redirection request
  window.addEventListener('UATO_COURSE_REDIRECT', event => {
    const { courseId } = event.detail || {};
    if (courseId) {
      console.log(`[Uato Naext] Received request to redirect to course ${courseId}`);
      handleCourseRedirection(courseId);
    }
  });

  // Check immediately for subjects when script loads
  const initialSubjects = getSubjectsFromStorage();
  if (initialSubjects) {
    console.log('[Uato Naext] Found subjects during initialization');
    window.dispatchEvent(
      new CustomEvent('UATO_API_RESPONSE', {
        detail: {
          type: 'subjects',
          data: initialSubjects,
        },
      }),
    );
  }

  // Monitor for changes to localStorage that might contain subjects
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    originalSetItem.call(this, key, value);

    if (key.startsWith('COURSES-')) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.data) {
          console.log('[Uato Naext] Detected new subjects data in localStorage');
          window.dispatchEvent(
            new CustomEvent('UATO_API_RESPONSE', {
              detail: {
                type: 'subjects',
                data: parsed.data,
              },
            }),
          );
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  };

  // Periodically clean up old captured headers
  setInterval(() => {
    if (capturedHeaders && lastCaptureTime) {
      const now = new Date();
      const timeSinceCapture = now.getTime() - lastCaptureTime.getTime();

      // Clear headers older than 1 minute
      if (timeSinceCapture > 60000) {
        console.log('[Uato Naext] Clearing old captured headers');
        capturedHeaders = null;
        lastCaptureTime = null;
      }
    }
  }, 30000); // Check every 30 seconds
})();
