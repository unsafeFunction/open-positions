const config = require('../config');

class ApiClient {
  constructor(baseUrl = null, apiSecret = null) {
    this.baseUrl = baseUrl || config.api.baseUrl;
    this.apiSecret = apiSecret || config.api.apiSecret;
  }

  async fetchUsersWithExchanges() {
    try {
      const response = await fetch(`${this.baseUrl}/exchanges`, {
        headers: {
          'x-api-secret': this.apiSecret
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      return data;
    } catch (error) {
      console.error('Error fetching users with exchanges:', error.message);
      return null;
    }
  }
}

module.exports = ApiClient;
