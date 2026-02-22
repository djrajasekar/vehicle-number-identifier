import { useState, useEffect, useRef } from "react";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { MdOnlinePrediction } from "react-icons/md";
import './App.css';

const bucketName = process.env.REACT_APP_S3_BUCKET || "vehicle-identifier-bucket";
const awsRegion = process.env.REACT_APP_AWS_REGION || "us-east-1";
const webSocketUrl = process.env.REACT_APP_WEBSOCKET_URL || "wss://mwtqeze40m.execute-api.us-east-1.amazonaws.com/dev-vehicle/";

const creds = {
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
};

if (!creds.accessKeyId || !creds.secretAccessKey) {
  console.warn("AWS credentials not configured. WebSocket connection may fail. Check .env.local file.");
}

const client = new S3Client({
  region: awsRegion,
  signatureVersion: 'v4',
  credentials: creds
}); 

function App() {
  const [image, setImage] = useState(null);
  const [message, setMessage] = useState("");
  const [ws, setWs] = useState(undefined);
  const [numberPlate, setNumberPlate] = useState("");
  const [socketStatusColour, setSocketStatusColour] = useState("grey")
  const responseTimeoutRef = useRef(null);

  useEffect(() => {
    console.log('........Connecting to server...........')
    console.log('WebSocket URL:', webSocketUrl);
    const webSocket = new WebSocket(webSocketUrl);
    setWs(webSocket);

    return () => {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
      webSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!ws) {
      return;
    }

    ws.onopen = (event) => {
      console.log('Connection established', event)
      setSocketStatusColour("green")
    };

    ws.onmessage = function (event) {
      console.log(`event`, event)
      try {
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        const data = JSON.parse(event.data);
        console.log('Number:', data.message)
        setMessage("Completed")
        setNumberPlate(`Number plate: ${data.message}`);

      } catch (err) {
        console.log(err);
      }
    };

    ws.onerror = (event) => {
      console.log('WebSocket error', event);
      setSocketStatusColour("red");
      setMessage("WebSocket error while processing image");
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed', event);
      setSocketStatusColour("grey");
    };
  }, [ws]);

  const processImage = async (event) => {  
    const selectedImage = event.target.files?.[0];
    if (!selectedImage) {
      return;
    }

    setNumberPlate(`Number plate: .....`);
    setImage(selectedImage)
    setMessage("Uploading... 0%")

    const uploadResult = await uploadFileToS3(selectedImage)
    if (uploadResult) {
      const imageName = selectedImage.name;
      await sendMessage(imageName);
    }
  }

  const uploadFileToS3 = async (image) => {
    setMessage("Uploading... 0%")
    const target = { Bucket: bucketName, Key: image.name, Body: image };
    try {
      const parallelUploads3 = new Upload({
        client: client,
        // tags: [{ Key: "connection_id", Value: "123"}], // optional tags
        queueSize: 4, // optional concurrency configuration
        leavePartsOnError: false, // optional manually handle dropped parts
        params: target,
      });

      parallelUploads3.on("httpUploadProgress", (progress) => {
        console.log("progress:", progress);
        const loaded = progress?.loaded || 0;
        const total = progress?.total || image.size || 0;

        if (total > 0) {
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          setMessage(`Uploading... ${percent}%`);
        } else {
          setMessage("Uploading...");
        }
      });

      await parallelUploads3.done();
      console.log('Upload done. Next step: send message to websocket');

      setMessage("Upload is done")
      return true;

    } catch (e) {
      console.log(e);
      setMessage("Upload is failed");
    }
    return false;
  }

  const sendMessage = async (imageName) => {
    try {
      if (!ws) {
        setMessage("WebSocket is not connected")
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) {
        setMessage("WebSocket not ready yet. Please try again in a moment")
        return;
      }

      setMessage(`Sending image ${imageName} info....`)

      const payload = {
        "action": "sendVehicleInfo",
        "message": { "bucket": bucketName, "key": imageName }
      };

      ws.send(JSON.stringify(payload));
      console.log('Message sent to websocket:', payload)

      setMessage("Processing image....")

      responseTimeoutRef.current = setTimeout(() => {
        setMessage("No response from server yet. Check backend logs.");
        console.log('No websocket response received within timeout window');
      }, 15000);
    }
    catch (err) {
      console.log("error", err)
      setMessage("Failed to send message to websocket")
    }

  }

  return (
    <div className="App">
      <header className="App-header">
        <h3>Vehicle Number Plate Recognition System</h3>
        <div id="web-socket-status"> <MdOnlinePrediction color={socketStatusColour} size={100} /></div>
        {
          image === null ? <div></div> : <img src={URL.createObjectURL(image)} style={{ height: 400, width: 400 }} />
        }

        <br></br>
        <input type="file" onChange={processImage} />
        <hr />
        <label id="message">{message}</label>
        <label id="numberPlate">{numberPlate}</label>
      </header>
    </div>
  );
}

export default App;