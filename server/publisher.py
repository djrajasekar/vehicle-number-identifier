"""WebSocket Publisher Module

This module handles sending data back to the frontend via AWS API Gateway WebSocket.
It's called by the main Lambda function after processing the vehicle image.

Author: DJ Rajasekar
Project: vehicle-number-identifier
"""

import json
import boto3
from botocore.config import Config

# API Gateway WebSocket callback URL
# Format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/
# IMPORTANT: Replace with your actual API Gateway WebSocket endpoint
callbackUrl = "https://mwtqeze40m.execute-api.us-east-1.amazonaws.com/dev-vehicle/"

# ============================================================================
# WEBSOCKET PUBLISHER
# ============================================================================

def publish(connection_id, data):    
    """Send data back to frontend client via WebSocket
    
    This function uses AWS API Gateway Management API to push data to a specific
    WebSocket connection. The frontend receives this data in the ws.onmessage handler.
    
    Key Points:
    - Uses HTTPS endpoint (not WSS) for API Gateway Management API
    - Requires connectionId from the WebSocket connection
    - Data must be JSON serializable
    - Connection ID is obtained from the Lambda event's requestContext
    
    Args:
        connection_id (str): WebSocket connection ID from API Gateway
        data (str): Number plate text or error message to send to frontend
    
    Raises:
        Exception: If WebSocket post fails (connection closed, invalid ID, etc.)
    
    """
    # Configure AWS client with region and signature version
    config = Config(
        region_name = 'us-east-1',
        signature_version = 'v4'  # AWS Signature Version 4 for authentication
    )
    
    try:
        # Initialize API Gateway Management API client
        # endpoint_url must be HTTPS (not WSS) for the management API
        client = boto3.client("apigatewaymanagementapi", endpoint_url=callbackUrl, config=config)
        
        # Send JSON response to the specific WebSocket connection
        # Frontend receives this in the ws.onmessage event handler
        client.post_to_connection(
            Data = json.dumps({ "success": True, "message": data}),
            ConnectionId = connection_id
        )
        
    except Exception as error:
        # Re-raise exception to be handled by Lambda handler
        # Common errors: Connection is stale (user closed browser), invalid connection ID
        raise Exception(error)