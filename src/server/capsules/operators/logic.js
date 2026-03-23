import { asUser, route } from "@forge/api";

/**
 * Get operator information by account ID
 *
 * @param {string} accountId - The Atlassian account ID
 * @param {string} [cloudId] - Optional cloud ID for building absolute URLs
 * @returns {Promise<Object>} Operator information including accountId, displayName, and profilePicture
 */
export async function identifyOperatorById(accountId, cloudId) {
  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
    );
    const operatorData = await response.json();

    // Handle profile picture URL - make it absolute if it's relative
    let profilePictureUrl = null;
    if (operatorData.profilePicture?.path) {
      const picturePath = operatorData.profilePicture.path;
      if (picturePath.startsWith("/")) {
        const baseUrl = cloudId ? `https://${cloudId}.atlassian.net` : "";
        profilePictureUrl = baseUrl + picturePath;
      } else {
        profilePictureUrl = picturePath;
      }
    }

    return {
      accountId: operatorData.accountId,
      displayName: operatorData.displayName,
      profilePicture: profilePictureUrl,
    };
  } catch (error) {
    console.error(`Failed to fetch operator info for ${accountId}:`, error);
    return {
      accountId,
      displayName: `User ${accountId.slice(-4)}`,
      profilePicture: null,
    };
  }
}

/**
 * Get realm information by realm key
 *
 * @param {string} realmKey - The Confluence realm key
 * @returns {Promise<Object>} Realm information including key, name, and id
 */
export async function getRealmInfo(realmKey) {
  if (!realmKey) {
    throw new Error("Realm key is required");
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/space/${realmKey}`,
    );

    if (response.ok) {
      const realmData = await response.json();
      return {
        key: realmData.key,
        name: realmData.name,
        id: realmData.id,
      };
    }

    return { key: realmKey, name: "Current Space", id: null };
  } catch (error) {
    return { key: realmKey, name: "Current Space", id: null };
  }
}

/**
 * Search for operators by query using Confluence CQL
 *
 * @param {string} query - The search query (minimum 2 characters)
 * @param {number} [limit=50] - Maximum number of results
 * @param {string} [cloudId] - Optional cloud ID for building absolute URLs
 * @returns {Promise<Array>} Array of operator objects with accountId, displayName, email, and profilePicture
 */
export async function searchOperatorsByName(query, limit = 50, cloudId) {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    console.log(`Searching operators with query: ${query}`);

    // Use the correct Confluence API endpoint with CQL parameter
    const cqlQuery = `user.fullname~${encodeURIComponent(query)}`;

    console.log(`Using CQL query: ${cqlQuery}`);

    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/search/user?cql=${cqlQuery}&limit=${limit}&expand=operations,personalSpace`,
    );

    if (response.ok) {
      const operators = await response.json();
      console.log(`Response keys:`, Object.keys(operators));
      console.log(`Response size:`, operators.size);
      console.log(`Results length:`, operators.results?.length);

      let operatorList = operators.results || [];
      if (!Array.isArray(operatorList)) {
        console.log(`No results array found in response`);
        operatorList = [];
      }

      const formattedOperators = operatorList
        .map((searchResult, index) => {
          console.log(`SearchResult ${index} keys:`, Object.keys(searchResult));

          const operator = searchResult.user;
          if (!operator) {
            console.log(`No operator object found in search result ${index}`);
            return null;
          }

          console.log(`Operator ${index} object:`, {
            accountId: operator.accountId,
            userKey: operator.userKey,
            displayName: operator.displayName,
            publicName: operator.publicName,
            email: operator.email,
            type: operator.type,
          });

          // Handle profile picture URL - make it absolute if needed
          let profilePictureUrl = null;
          if (operator.profilePicture?.path) {
            const picturePath = operator.profilePicture.path;
            if (picturePath.startsWith("/")) {
              const baseUrl = cloudId ? `https://${cloudId}.atlassian.net` : "";
              profilePictureUrl = baseUrl + picturePath;
            } else {
              profilePictureUrl = picturePath;
            }
          }

          const accountId = operator.accountId || operator.userKey || null;
          const displayName =
            operator.displayName ||
            operator.publicName ||
            (accountId ? `User ${accountId.slice(-4)}` : "Unknown User");
          const email = operator.email || null;

          console.log(`Final operator ${index}:`, {
            accountId,
            displayName,
            email,
          });

          return {
            accountId,
            displayName,
            email,
            profilePicture: profilePictureUrl,
          };
        })
        .filter((operator) => operator !== null);

      console.log(`Found ${formattedOperators.length} operators for query: ${query}`);
      if (formattedOperators.length > 0) {
        console.log(`Sample operator:`, formattedOperators[0]);
      }
      return formattedOperators;
    }

    console.warn(`Operator search failed: ${response.status}`);
    const errorText = await response.text();
    console.warn(`Error details: ${errorText}`);
    return [];
  } catch (error) {
    console.error("Error searching operators:", error);
    return [];
  }
}

/**
 * Get initial operators for dropdown (first 10 operators)
 *
 * @param {string} [cloudId] - Optional cloud ID for building absolute URLs
 * @returns {Promise<Array>} Array of operator objects
 */
export async function getInitialOperators(cloudId) {
  try {
    console.log("Fetching initial 10 operators for dropdown");

    const cqlQuery = `type=user`;

    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/search/user?cql=${cqlQuery}&limit=10&expand=`,
    );

    if (response.ok) {
      const operators = await response.json();

      let operatorList = operators.results || [];
      if (!Array.isArray(operatorList)) {
        operatorList = [];
      }

      const formattedOperators = operatorList
        .map((searchResult) => {
          const operator = searchResult.user;
          if (!operator) return null;

          const accountId = operator.accountId || operator.userKey || null;
          const displayName =
            operator.displayName ||
            operator.publicName ||
            (accountId ? `User ${accountId.slice(-4)}` : "Unknown User");
          const email = operator.email || null;

          return {
            accountId,
            displayName,
            email,
            profilePicture: null,
          };
        })
        .filter((operator) => operator !== null);

      console.log(`Found ${formattedOperators.length} initial operators`);
      return formattedOperators;
    }

    return [];
  } catch (error) {
    console.error("Error fetching initial operators:", error);
    return [];
  }
}
