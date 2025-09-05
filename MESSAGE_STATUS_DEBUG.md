# Message Status Debug Guide

## Debug Logs Added

### 1. Message Rendering (`renderMessage`)
- Logs message properties: ID, sender, status, type, client_id
- Shows when each message is being rendered

### 2. MessageStatusIndicator Component
- Logs when component receives props
- Shows when it decides not to render (not outgoing or no status)

### 3. Socket Event Handlers
- `message_delivered`: Logs event receipt and current message state
- `messages_seen`: Logs event receipt and message IDs being updated
- `receive_chat_message`: Enhanced logging for own message echo reconciliation

### 4. Message Sending
- Logs client_id generation
- Logs local message creation with status
- Logs when message is added to state

### 5. Status Update Function (`updateMessageStatus`)
- Enhanced logging for message lookup by server ID and client ID
- Shows mapping between server and client IDs

## Testing Steps

1. **Send a message** - Look for:
   ```
   [DEBUG] Sending message with client_id: [timestamp]
   [DEBUG] Created local message with status: sent client_id: [timestamp]
   [DEBUG] Adding local message to state: [message object]
   [DEBUG] Rendering message: { message_id: [id], sender: [username], isOutgoing: true, status: "sent", type: "text" }
   [MessageStatusIndicator] Rendering with props: { status: "sent", isOutgoing: true, size: 12 }
   ```

2. **Message delivery** - Look for:
   ```
   [CLIENT] Message delivered event received: [event data]
   [CLIENT] Current messages state before update: [array of messages]
   [CLIENT] updateMessageStatus called with messageId: [id] status: delivered
   [CLIENT] Found message by server ID, updating status from sent to delivered
   [DEBUG] Rendering message: { ..., status: "delivered" }
   [MessageStatusIndicator] Rendering with props: { status: "delivered", isOutgoing: true, size: 12 }
   ```

3. **Message seen** - Look for:
   ```
   [CLIENT] messages_seen event received: [event data]
   [CLIENT] Current messages state before seen update: [array of messages]
   [CLIENT] Updating messages [ids] to seen
   [DEBUG] Rendering message: { ..., status: "seen" }
   [MessageStatusIndicator] Rendering with props: { status: "seen", isOutgoing: true, size: 12 }
   ```

## Expected UI Behavior

- **Sent**: Single gray checkmark ✓
- **Delivered**: Double gray checkmarks ✓✓
- **Seen**: Double green checkmarks ✓✓ (green)

## Common Issues to Check

1. **Status not showing**: Check if `isOutgoing` is true and `status` exists
2. **Status not updating**: Check if `message_delivered`/`messages_seen` events are received
3. **ID mapping issues**: Check if `client_id` to `server_id` mapping is working
4. **Component not rendering**: Check if MessageStatusIndicator is being called with correct props

## Backend Requirements

Ensure backend emits:
- `message_delivered` with `message_id` when recipient is online
- `messages_seen` with `message_ids` array when messages are marked as seen
- `receive_chat_message` includes `client_id` for echo reconciliation

## Issue Found

**Backend IS emitting socket events, but missing `client_id` in `receive_chat_message`!**

Backend correctly emits:
- ✅ `message_delivered` event to sender 
- ✅ `messages_seen` event to sender

**Missing**: `client_id` in `receive_chat_message` event for echo reconciliation.

Backend needs to add `client_id` to the `receive_chat_message` emission:
```python
# In send_chat_message handler, add client_id:
emit('receive_chat_message', {
    'from': sender,
    'message': message,
    'timestamp': now_utc.isoformat()+'Z',
    'client_id': data.get('client_id'),  # ADD THIS LINE
    'message_id': msg_obj.id,
    'status': msg_obj.status,
    # ... other fields
}, room=room, include_self=True)
```
