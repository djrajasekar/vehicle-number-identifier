"""Vehicle Number Plate Recognition Lambda Function

This AWS Lambda function processes vehicle images uploaded to S3 and extracts
number plate information using AWS Rekognition. Results are sent back to the
frontend via WebSocket connection.

Author: DJ Rajasekar
Project: vehicle-number-identifier
"""

import boto3, json
from publisher import publish

# Initialize S3 client for accessing uploaded vehicle images
s3_client = boto3.client('s3', "us-east-1")

# ============================================================================
# MAIN HANDLER
# ============================================================================

def lambda_handler(event, context):
    """Main Lambda handler invoked by API Gateway WebSocket
    
    Workflow:
    1. Receives message from frontend via WebSocket containing S3 image location
    2. Extracts bucket name and image key from the message
    3. Calls Rekognition to detect text in the image
    4. Sends detected number plate back to frontend via WebSocket
    
    Args:
        event (dict): API Gateway WebSocket event containing:
            - body: JSON string with bucket and key information
            - requestContext: Contains connectionId for WebSocket response
        context (object): Lambda context object (not used)
    
    Returns:
        dict: Response with statusCode and body containing success status and message
    """
    
    try:
        print(f'event: {event}')
        
        # Parse the incoming WebSocket message
        message_body = json.loads(event["body"])        
        message =  message_body['message']        
        bucket = message["bucket"]  # S3 bucket name
        key = message["key"]        # Image filename in S3
        
        # Get WebSocket connection ID for sending response back to client
        connection_id = event["requestContext"].get("connectionId")
        
        print(f'bucket: {bucket}, key: {key}, connection_id: {connection_id} ')

        # Process the image and extract number plate using AWS Rekognition
        number_plate = extract_number_plate(bucket, key)
        
        # Send result back to frontend via WebSocket if connection exists
        if(connection_id != None):
            publish(connection_id, number_plate)
        
        # Return success response to API Gateway
        return {
            'statusCode': 200,
            'body': json.dumps({"success": True, "message": number_plate})
        }
        
    except Exception as error:
        # Log error and return failure response
        print(f'Error occurrred. {error}')
        return {
            'statusCode': 500,
            'body': json.dumps({"success": False, "message": "Failed"})
        }

# ============================================================================
# IMAGE PROCESSING FUNCTIONS
# ============================================================================

def extract_number_plate(bucket, key):
    """Extract number plate from vehicle image
    
    This function orchestrates the number plate extraction by:
    1. Getting all detected text from the image
    2. Returning the first valid number plate found
    
    Args:
        bucket (str): S3 bucket name where image is stored
        key (str): S3 object key (filename) of the vehicle image
    
    Returns:
        str: Detected number plate or error message if not found
    """
    list = get_detected_text_list(bucket, key)
    print('List', list)
    
    # Return first valid number plate found, or error message
    if(list != None and len(list) > 0):
        return list[0]
    return "Unable to find number"


def get_detected_text_list(bucket, key):
    """Use AWS Rekognition to detect text in vehicle image
    
    This function:
    1. Calls AWS Rekognition DetectText API on the S3 image
    2. Extracts all detected text from the response
    3. Validates each detected text to filter out non-number-plate text
    4. Returns a list of valid number plates
    
    AWS Rekognition can detect various text in an image (street signs, billboards, etc.)
    We use validation logic to identify which text is likely the number plate.
    
    Args:
        bucket (str): S3 bucket name
        key (str): S3 object key (image filename)
    
    Returns:
        list: List of validated number plate texts
    """
    response = {}
    
    # Initialize AWS Rekognition client
    client = boto3.client('rekognition', "us-east-1")
    
    # Call Rekognition DetectText API
    # This API detects text in images using machine learning OCR
    response = client.detect_text(Image= {
        'S3Object': {
            'Bucket': bucket,
            'Name': key
        }
    })
    print(f'Response: {response}')
    
    # Extract all text detections from response
    list_of_detected_object = response["TextDetections"]
    
    # Filter and validate detected text to find number plates
    list_of_detected_text = []
    if(list_of_detected_object != None):
        for item in list_of_detected_object:
            # Validate each detected text (checks format, length, etc.)
            validated_text = validate_detected_text(item["DetectedText"])
            if(validated_text != None):
                list_of_detected_text.append(validated_text)

    return list_of_detected_text


# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

def validate_detected_text(text):
    """Validate if detected text matches number plate format
    
    Current validation logic:
    - Text must be exactly 8 characters long (common number plate length)
    - Leading/trailing whitespace is removed
    
    Note: This is a simple validation. For production, consider:
    - Regex patterns for specific country formats (e.g., XX00XXXX)
    - Alphanumeric character validation
    - Case normalization
    - Multiple number plate format support
    
    Args:
        text (str): Detected text from Rekognition
    
    Returns:
        str: Validated number plate text, or None if invalid
    """
    # Remove leading/trailing whitespace
    text = text.strip()
    
    # Check if length matches expected number plate format (8 characters)
    if(len(text) != 8):
        return None
    
    return text