const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        index: true
    },
    uuid: {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    device_id: {
        type: String,
        default: 'web_browser'
    },
    device_name: {
        type: String,
        default: 'Web Browser'
    },
    first_seen: {
        type: Date,
        default: Date.now
    },
    last_seen: {
        type: Date,
        default: Date.now
    },
    message_count: {
        type: Number,
        default: 0
    },
    is_active: {
        type: Boolean,
        default: true
    }
});

// Compound index for faster lookups
deviceSchema.index({ email: 1, uuid: 1 });

module.exports = mongoose.model('Device', deviceSchema);