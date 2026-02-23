// Import React hooks and AWS SDK components
import { useState, useEffect, useRef } from "react";
import { S3Client } from "@aws-sdk/client-s3"; // AWS SDK for S3 operations
import { Upload } from "@aws-sdk/lib-storage"; // Handles large file uploads with progress tracking
import { MdOnlinePrediction } from "react-icons/md"; // Icon for WebSocket connection status
import './App.css';

// Configuration: Read from environment variables (.env.local) or use fallback values
// Environment variables keep sensitive data out of the codebase
const bucketName = process.env.REACT_APP_S3_BUCKET || "vehicle-identifier-bucket";
const awsRegion = process.env.REACT_APP_AWS_REGION || "us-east-1";
const webSocketUrl = process.env.REACT_APP_WEBSOCKET_URL || "wss://mwtqeze40m.execute-api.us-east-1.amazonaws.com/dev-vehicle/";

// AWS credentials: Required for S3 upload authentication
const creds = {
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
};

// Warn if credentials are missing (app won't work without them)
if (!creds.accessKeyId || !creds.secretAccessKey) {
  console.warn("AWS credentials not configured. WebSocket connection may fail. Check .env.local file.");
}

// Initialize S3 client for file uploads
const client = new S3Client({
  region: awsRegion,
  signatureVersion: 'v4',
  credentials: creds
}); 

function App() {
  // State Management
  // ----------------
  const [image, setImage] = useState(null); // Stores the selected image file for preview
  const [message, setMessage] = useState(""); // Status messages shown to user (uploading, processing, etc.)
  const [ws, setWs] = useState(undefined); // WebSocket connection object for real-time communication
  const [numberPlate, setNumberPlate] = useState(""); // Detected number plate result from backend
  const [socketStatusColour, setSocketStatusColour] = useState("grey") // WebSocket connection indicator color (grey=disconnected, green=connected, red=error)
  const responseTimeoutRef = useRef(null); // Timer to detect if backend doesn't respond within 15 seconds

  // WebSocket Connection Setup
  // --------------------------
  // Runs once when component mounts, establishes persistent connection to backend
  useEffect(() => {
    console.log('........Connecting to server...........')
    console.log('WebSocket URL:', webSocketUrl);
    const webSocket = new WebSocket(webSocketUrl);
    setWs(webSocket);

    // Cleanup function: Runs when component unmounts
    return () => {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
      webSocket.close();
    };
  }, []); // Empty dependency array = run once on mount

  // WebSocket Event Handlers
  // ------------------------
  // Runs whenever the WebSocket connection (ws) changes
  useEffect(() => {
    if (!ws) {
      return; // Exit if WebSocket hasn't been created yet
    }

    // Connection successfully opened
    ws.onopen = (event) => {
      console.log('Connection established', event)
      setSocketStatusColour("green") // Show green indicator
    };

    // Message received from backend (contains detected number plate)
    ws.onmessage = function (event) {
      console.log(`event`, event)
      try {
        // Clear the response timeout since we got a reply
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        
        const data = JSON.parse(event.data);
        console.log('Number:', data.message)
        setMessage("Completed")
        setNumberPlate(`Number plate: ${data.message}`); // Display the detected plate number

      } catch (err) {
        console.log(err);
      }
    };

    // WebSocket error occurred
    ws.onerror = (event) => {
      console.log('WebSocket error', event);
      setSocketStatusColour("red"); // Show red indicator
      setMessage("WebSocket error while processing image");
    };

    // WebSocket connection closed
    ws.onclose = (event) => {
      console.log('WebSocket closed', event);
      setSocketStatusColour("grey"); // Show grey indicator
    };
  }, [ws]); // Re-run when ws changes

  // Image Selection Handler
  // -----------------------
  // Called when user selects a file from their computer
  // Coordinates the entire workflow: preview → upload to S3 → send to backend
  const processImage = async (event) => {  
    const selectedImage = event.target.files?.[0];
    if (!selectedImage) {
      return; // No file selected, exit early
    }

    // Reset UI for new upload
    setNumberPlate(`Number plate: .....`); // Show placeholder
    setImage(selectedImage) // Display image preview
    setMessage("Uploading... 0%") // Initialize upload progress

    // Step 1: Upload image to S3 bucket
    const uploadResult = await uploadFileToS3(selectedImage)
    
    // Step 2: If upload succeeded, notify backend to process the image
    if (uploadResult) {
      const imageName = selectedImage.name;
      await sendMessage(imageName); // Backend will use this name to fetch from S3
    }
  }

  // S3 Upload Function with Progress Tracking
  // -----------------------------------------
  // Uploads the selected image file to AWS S3 bucket using multipart upload
  // Shows real-time progress percentage (0-100%) to the user
  const uploadFileToS3 = async (image) => {
    setMessage("Uploading... 0%")
    
    // Configure S3 upload parameters
    const target = { Bucket: bucketName, Key: image.name, Body: image };
    
    try {
      // Use AWS SDK Upload class for efficient multipart uploads
      const parallelUploads3 = new Upload({
        client: client, // S3 client from configuration
        queueSize: 4, // Upload 4 parts simultaneously for speed
        leavePartsOnError: false, // Clean up failed uploads automatically
        params: target,
      });

      // Track upload progress and update UI
      parallelUploads3.on("httpUploadProgress", (progress) => {
        console.log("progress:", progress);
        const loaded = progress?.loaded || 0; // Bytes uploaded so far
        const total = progress?.total || image.size || 0; // Total file size

        if (total > 0) {
          // Calculate and display percentage (0-100%)
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          setMessage(`Uploading... ${percent}%`);
        } else {
          setMessage("Uploading..."); // Fallback if size unknown
        }
      });

      // Wait for upload to complete
      await parallelUploads3.done();
      console.log('Upload done. Next step: send message to websocket');

      setMessage("Upload is done")
      return true; // Success

    } catch (e) {
      console.log(e);
      setMessage("Upload is failed");
    }
    return false; // Failed
  }

  // WebSocket Message Sender with Timeout
  // -------------------------------------
  // Sends image filename to backend via WebSocket for number plate detection
  // Backend will fetch the image from S3, run Rekognition, and send results back
  // Timeout: 15 seconds - if no response, alerts user to check backend logs
  const sendMessage = async (imageName) => {
    try {
      // Validate WebSocket exists
      if (!ws) {
        setMessage("WebSocket is not connected")
        return;
      }

      // Validate WebSocket is connected and ready
      if (ws.readyState !== WebSocket.OPEN) {
        setMessage("WebSocket not ready yet. Please try again in a moment")
        return;
      }

      setMessage(`Sending image ${imageName} info....`)

      // Prepare message payload for backend Lambda
      const payload = {
        "action": "sendVehicleInfo", // Backend route handler name
        "message": { "bucket": bucketName, "key": imageName } // S3 location of uploaded image
      };

      // Send message to backend (note: ws.send() is synchronous, doesn't return anything)
      ws.send(JSON.stringify(payload));
      console.log('Message sent to websocket:', payload)

      setMessage("Processing image....")

      // Set 15-second timeout to detect backend failures
      // This will be cleared if we receive a response in the ws.onmessage handler
      responseTimeoutRef.current = setTimeout(() => {
        setMessage("No response from server yet. Check backend logs.");
        console.log('No websocket response received within timeout window');
      }, 15000); // 15 seconds
    }
    catch (err) {
      console.log("error", err)
      setMessage("Failed to send message to websocket")
    }

  }

  // UI Rendering
  // ------------
  // Main component layout: Header with status indicator, image preview, file input, and results display
  return (
    <div className="App">
      <header className="App-header">
        {/* Application title */}
        <h3>Vehicle Number Plate Recognition System</h3>
        
        {/* WebSocket connection status indicator (grey=disconnected, green=connected, red=error) */}
        <div id="web-socket-status"> 
          <MdOnlinePrediction color={socketStatusColour} size={100} />
        </div>
        
        {/* Image preview - only shown after user selects a file */}
        {
          image === null ? <div></div> : <img src={URL.createObjectURL(image)} alt="Selected vehicle for number plate recognition" style={{ height: 400, width: 400 }} />
        }

        <br></br>
        
        {/* File input - triggers processImage() when user selects an image */}
        <input type="file" onChange={processImage} />
        
        <hr />
        
        {/* Status message display (uploading progress, processing status, errors) */}
        <label id="message">{message}</label>
        
        {/* Detected number plate result displayed here after backend processes image */}
        <label id="numberPlate">{numberPlate}</label>
      </header>
    </div>
  );
}

export default App;