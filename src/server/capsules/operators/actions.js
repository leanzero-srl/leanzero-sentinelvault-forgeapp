import { asUser, route } from "@forge/api";

/**
 * Get operator information by account ID
 */
const identifyOperator = async (req) => {
  const { accountId } = req.payload;

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
    );
    const operatorData = await response.json();

    let profilePictureUrl = null;
    if (operatorData.profilePicture?.path) {
      const picturePath = operatorData.profilePicture.path;
      if (picturePath.startsWith("/")) {
        const baseUrl = req.context.cloudId
          ? `https://${req.context.cloudId}.atlassian.net`
          : "";
        profilePictureUrl = baseUrl + picturePath;
      } else {
        profilePictureUrl = picturePath;
      }
    }

    return {
      accountId: operatorData.accountId,
      displayName: operatorData.displayName,
      email: operatorData.email || null,
      profilePicture: profilePictureUrl,
    };
  } catch (error) {
    console.error(`Failed to fetch operator info for ${accountId}:`, error);
    return {
      accountId,
      displayName: `User ${accountId.slice(-4)}`,
      email: null,
      profilePicture: null,
    };
  }
};

/**
 * Search for operators by display name with pagination support
 */
const searchOperators = async (req) => {
  const { query, start = 0, limit = 20 } = req.payload;

  if (!query || query.length < 2) {
    return {
      users: [],
      hasMore: false,
      nextStart: null,
    };
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/search/user?cql=user.fullName~"${query}"&start=${start}&limit=${limit}`,
    );

    if (!response.ok) {
      console.error("Failed to search operators:", response.status);
      return {
        users: [],
        hasMore: false,
        nextStart: null,
      };
    }

    const data = await response.json();
    const results = data.results || [];

    const formattedOperators = results
      .map((searchResult) => {
        const operator = searchResult.user || searchResult;
        if (!operator) return null;

        const accountId = operator.accountId || operator.userKey || null;
        if (!accountId) return null;

        const displayName =
          operator.displayName ||
          operator.publicName ||
          (accountId ? `User ${accountId.slice(-4)}` : "Unknown User");

        let profilePictureUrl = null;
        if (operator.profilePicture?.path) {
          const picturePath = operator.profilePicture.path;
          if (picturePath.startsWith("/")) {
            const baseUrl = req.context.cloudId
              ? `https://${req.context.cloudId}.atlassian.net`
              : "";
            profilePictureUrl = baseUrl + picturePath;
          } else {
            profilePictureUrl = picturePath;
          }
        }

        return {
          accountId,
          displayName,
          email: operator.email || null,
          profilePicture: profilePictureUrl,
        };
      })
      .filter((operator) => operator !== null);

    const hasMore = !!(data._links && data._links.next);
    const nextStart = hasMore ? start + limit : null;

    return {
      users: formattedOperators,
      hasMore,
      nextStart,
    };
  } catch (error) {
    console.error("Error searching operators:", error);
    return {
      users: [],
      hasMore: false,
      nextStart: null,
    };
  }
};

/**
 * Get current operator information
 */
const whoami = async (req) => {
  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/user/current`,
    );

    if (!response.ok) {
      console.error("Failed to fetch current operator:", response.status);
      return {
        accountId: req.context.accountId,
        displayName: "Current User",
        email: null,
        profilePicture: null,
      };
    }

    const operatorData = await response.json();

    let profilePictureUrl = null;
    if (operatorData.profilePicture?.path) {
      const picturePath = operatorData.profilePicture.path;
      if (picturePath.startsWith("/")) {
        const baseUrl = req.context.cloudId
          ? `https://${req.context.cloudId}.atlassian.net`
          : "";
        profilePictureUrl = baseUrl + picturePath;
      } else {
        profilePictureUrl = picturePath;
      }
    }

    return {
      accountId: operatorData.accountId,
      displayName: operatorData.displayName,
      email: operatorData.email || null,
      profilePicture: profilePictureUrl,
    };
  } catch (error) {
    console.error("Error fetching current operator:", error);
    return {
      accountId: req.context.accountId,
      displayName: "Current User",
      email: null,
      profilePicture: null,
    };
  }
};

/**
 * Get initial operators for dropdown with pagination support
 */
const enumerateOperators = async (req) => {
  try {
    const { start = 0, limit = 10 } = req.payload;
    console.log(
      `Fetching operators with pagination: start=${start}, limit=${limit}`,
    );

    const cqlQuery = `type=user`;

    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/search/user?cql=${cqlQuery}&start=${start}&limit=${limit}&expand=`,
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

      const hasMore = !!(operators._links && operators._links.next);
      const nextStart = hasMore ? start + limit : null;

      console.log(
        `Found ${formattedOperators.length} operators, hasMore=${hasMore}, nextStart=${nextStart}`,
      );

      return {
        users: formattedOperators,
        hasMore,
        nextStart,
      };
    }

    return {
      users: [],
      hasMore: false,
      nextStart: null,
    };
  } catch (error) {
    console.error("Error fetching initial operators:", error);
    return {
      users: [],
      hasMore: false,
      nextStart: null,
    };
  }
};

/**
 * Get teams in Confluence instance with pagination support
 */
const enumerateTeams = async (req) => {
  try {
    const { start = 0, limit = 200 } = req.payload;
    console.log(
      `Fetching teams with pagination: start=${start}, limit=${limit}`,
    );

    const response = await asUser().requestConfluence(
      route`/rest/api/group?start=${start}&limit=${limit}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Teams API failed with status ${response.status}: ${errorText}`,
      );

      // Try fallback endpoint for older Confluence versions
      if (start === 0) {
        console.log("Trying fallback endpoint: /rest/api/group");
        const fallbackResponse = await asUser().requestConfluence(
          route`/rest/api/group?start=${start}&limit=${limit}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.text();
          throw new Error(
            `Both team endpoints failed. Primary: ${response.status} ${errorText}. Fallback: ${fallbackResponse.status} ${fallbackError}`,
          );
        }

        const fallbackData = await fallbackResponse.json();
        console.log("Fallback endpoint worked, using /rest/api/group");

        const teamNames =
          fallbackData.results?.map((group) => group.name) || [];

        const hasMore = !!(fallbackData._links && fallbackData._links.next);
        const nextStart = hasMore ? start + limit : null;

        console.log(
          `Fetched ${teamNames.length} teams from Confluence (fallback), hasMore=${hasMore}, nextStart=${nextStart}`,
        );

        return {
          groups: teamNames,
          hasMore,
          nextStart,
        };
      } else {
        throw new Error(
          `Failed to fetch teams: ${response.status} ${errorText}`,
        );
      }
    }

    const teamsData = await response.json();

    if (teamsData.results && Array.isArray(teamsData.results)) {
      const teamNames = teamsData.results.map((group) => group.name);

      const hasMore = !!(teamsData._links && teamsData._links.next);
      const nextStart = hasMore ? start + limit : null;

      console.log(
        `Fetched ${teamNames.length} teams, hasMore=${hasMore}, nextStart=${nextStart}`,
      );

      return {
        groups: teamNames,
        hasMore,
        nextStart,
      };
    } else {
      console.warn("Unexpected response format - no results array found");
      return {
        groups: [],
        hasMore: false,
        nextStart: null,
      };
    }
  } catch (error) {
    console.error("Failed to fetch teams from Confluence:", error);
    return {
      groups: [],
      hasMore: false,
      nextStart: null,
    };
  }
};

export const actions = [
  ["identify-operator", identifyOperator],
  ["search-operators", searchOperators],
  ["current-operator", whoami],
  ["enumerate-operators", enumerateOperators],
  ["enumerate-teams", enumerateTeams],
];
