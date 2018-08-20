// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-LinkedIn.js"

const { parse, URL } = require("url")

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
})
const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const LinkedIn = require("./lib-LinkedIn")
const linkedIn = new LinkedIn(nick, buster, utils)
// }


// Checks if a url is already in the csv
const checkDb = (str, db) => {
	for (const line of db) {
		if (str === line.query) {
			return false
		}
	}   
	return true
}


const createUrl = (search, circles) => {
	const circlesOpt = `facet=N${circles.first ? "&facet.N=F" : ""}${circles.second ? "&facet.N=S" : ""}${circles.third ? "&facet.N=O" : ""}`
	return (`https://www.linkedin.com/sales/search?keywords=${encodeURIComponent(search)}&count=100&${circlesOpt}`) 
}

// forces the search to display up to 100 profiles per page
const forceCount = (url) => {
	try {
		let parsedUrl = new URL(url)
		parsedUrl.searchParams.set("count", "100")
		return parsedUrl.toString()
	} catch (err) {
		return url
	}
}

const scrapeResults = (arg, callback) => {
	const results = document.querySelectorAll("div.search-results ul > li, ul#results-list > li")
	const infos = []
	let profilesScraped = 0
	for (const result of results) {
		if (result.querySelector(".name-link.profile-link")) {
			const url = result.querySelector(".name-link.profile-link").href
			let newInfos = { url }
			newInfos.name = result.querySelector(".name a").title.trim()
			if (result.querySelector(".details-container abbr")) { newInfos.degree = result.querySelector(".details-container abbr").textContent.trim() }
			newInfos.profileImageUrl = result.querySelector(".entity-image") ? result.querySelector(".entity-image").src : result.querySelector(".person-ghost").src
			if (result.querySelector(".sublink-item a").textContent.indexOf("Shared") > -1) { newInfos.sharedConnections = result.querySelector(".sublink-item a").textContent.slice(20).slice(0,-1) }
			if (result.querySelector(".premium-icon")) { newInfos.premium = "Premium" }
			if (result.querySelector(".openlink-badge")) { newInfos.openProfile = "Open Profile" }
			if (result.querySelector(".company-name")) { 
				newInfos.companyName = result.querySelector(".company-name").title
				if (result.querySelector(".company-name").href) {
					const salesCompanyUrl = new URL(result.querySelector(".company-name").href)
					if (salesCompanyUrl.searchParams.get("companyId")) {
						const companyId = salesCompanyUrl.searchParams.get("companyId")
						newInfos.companyId = companyId
						newInfos.companyUrl = "https://www.linkedin.com/company/" + companyId
					}
				}
			}
			const memberId = result.className.split(" ").pop()
			if (memberId.startsWith("m")) {
				newInfos.memberId = memberId.substr(1)
			}
			newInfos.title = result.querySelector(".info-value").textContent.trim()
			if (result.querySelector(".info-value:nth-child(2)")) { newInfos.duration = result.querySelector(".info-value:nth-child(2)").textContent.trim() }
			if (result.querySelector(".info-value:nth-child(3)")) { newInfos.location = result.querySelector(".info-value:nth-child(3)").textContent.trim() }
			if (arg.query) { newInfos.query = arg.query }
			infos.push(newInfos)
		}
		if (++profilesScraped >= arg.numberOnThisPage) { break }
	}
	callback(null, infos)
}

const scrapeResultsLeads = (arg, callback) => {
	const results = document.querySelectorAll("ol.search-results__result-list li .search-results__result-container")
	const infos = []
	let profilesScraped = 0
	for (const result of results) {
		if (result.querySelector(".result-lockup__name")) {
			const url = result.querySelector(".result-lockup__name a").href
			let newInfos = { url }
			newInfos.name = result.querySelector(".result-lockup__name").textContent.trim()
			if (result.querySelector(".result-lockup__highlight-keyword")) {
				newInfos.title = result.querySelector(".result-lockup__highlight-keyword").innerText
				newInfos.companyName = result.querySelector(".result-lockup__position-company").innerText
			}
			if (result.querySelector(".result-context.relative.pt1 dl dd")) { newInfos.pastRole = result.querySelector(".result-context.relative.pt1 dl dd").innerText }
			if (arg.query) { newInfos.query = arg.query }
			infos.push(newInfos)
		}
		if (++profilesScraped >= arg.numberOnThisPage) { break }
	}
	callback(null, infos)
}

const totalResults = (arg, callback) => {
	const total = document.querySelector(arg.selector).textContent
	callback(null, total)
}

/**
 * @description Tiny wrapper used to easly change the page index of LinkedIn search results
 * @param {String} url
 * @param {Number} index - Page index
 * @return {String} URL with the new page index
 */
const overridePageIndex = (url, page) => {
	try {
		let parsedUrl = new URL(url)
		parsedUrl.searchParams.set("start", page === 1 ? "0" : page - 1 + "00")
		return parsedUrl.toString()
	} catch (err) {
		return url
	}
}

const overridePageIndexLead = (url, page) => {
	try {
		let parsedUrl = new URL(url)
		parsedUrl.searchParams.set("page", page)
		return parsedUrl.toString()
	} catch (err) {
		return url
	}
}

const getSearchResults = async (tab, searchUrl, numberOfProfiles, query) => {
	utils.log(`Getting data${query ? ` for search ${query}` : ""} ...`, "loading")
	let pageCount
	let result = []
	const selectors = ["section.search-results-container", "section.search-results__container"]
	let profilesFoundCount = 0
	let maxResults = Math.min(1000, numberOfProfiles)
	let isLeadSearch
	let numberPerPage
	await tab.open(searchUrl)
	try {
		const selector = await tab.waitUntilVisible([".spotlight-result-count", ".artdeco-tab-primary-text"], 7500, "or")
		const resultsCount = await tab.evaluate(totalResults, { selector })
		if (selector === ".artdeco-tab-primary-text") { 
			isLeadSearch = true
			numberPerPage = 25
		} else {
			isLeadSearch = false
			numberPerPage = 100
		}
		pageCount = Math.ceil(numberOfProfiles / numberPerPage) // 25 or 100 results per page

		utils.log(`Getting ${resultsCount} results`, "done")
		let multiplicator = 1
		if (resultsCount.includes("K")) { multiplicator = 1000 }
		if (resultsCount.includes("M")) { multiplicator = 1000000 }
		maxResults = Math.min(parseFloat(resultsCount) * multiplicator, maxResults)
	} catch (err) {
		utils.log(`Could not get total results count. ${err}`, "warning")
	}
	for (let i = 1; i <= pageCount; i++) {
		try {
			if (isLeadSearch) {
				await tab.open(overridePageIndexLead(searchUrl, i))
			} else {
				await tab.open(overridePageIndex(searchUrl, i))
			}
			utils.log(`Getting results from page ${i}...`, "loading")
			let containerSelector
			try {
				containerSelector = await tab.waitUntilVisible(selectors, 7500, "or")
			} catch (err) {
				// No need to go any further, if the API can't determine if there are (or not) results in the opened page
				utils.log("Error getting a response from LinkedIn, this may not be a Sales Navigator Account", "warning")
				return result
			}
			await tab.waitUntilVisible([".spotlight-result-label", ".artdeco-tab-primary-text"], 7500, "or")
			await tab.scrollToBottom()
			await tab.wait(1500)
			const numberOnThisPage = Math.min(numberOfProfiles - numberPerPage * (i - 1), numberPerPage)
			const timeLeft = await utils.checkTimeLeft()
			if (!timeLeft.timeLeft) {
				utils.log(timeLeft.message, "warning")
				break
			}
			if (containerSelector === "section.search-results__container") { // Lead Search
				try {
					result = result.concat(await tab.evaluate(scrapeResultsLeads, {query, numberOnThisPage}))		
				} catch (err) {
					//
				}
			} else {
				result = result.concat(await tab.evaluate(scrapeResults, {query, numberOnThisPage}))
			}
			if (result.length > profilesFoundCount) {
				profilesFoundCount = result.length
				buster.progressHint(profilesFoundCount / maxResults, `${profilesFoundCount} profiles loaded`)
			} else {
				utils.log("No more profiles found on this page", "warning")
				break
			}
		} catch (err) {
			utils.log(`Error scraping this page: ${err}`, "error")
		}
	}
	buster.progressHint(1, `${profilesFoundCount} profiles loaded`)
	utils.log("All pages with result scrapped.", "done")
	return result
}

const isLinkedInSearchURL = (url) => {
	let urlObject = parse(url.toLowerCase())
	if (urlObject && urlObject.hostname) {
		if (url.includes("linkedin.com/")) {
			if (urlObject.pathname.startsWith("linkedin")) {
				urlObject = parse("https://www." + url)
			}
			if (urlObject.pathname.startsWith("www.linkedin")) {
				urlObject = parse("https://" + url)
			}
			if (urlObject.hostname === "www.linkedin.com" && urlObject.pathname.startsWith("/sales/search")) {
				return 0 // LinkedIn Sales Navigator search
			} else if (urlObject.hostname === "www.linkedin.com" && urlObject.pathname.startsWith("/search/results/")) {
				return -1 // Default LinkedIn search
			}
		}
		return -2 // URL not from LinkedIn	
	}
	return 1 // not a URL
}

;(async () => {
	const tab = await nick.newTab()
	let { sessionCookie, searches, circles, numberOfProfiles, csvName } = utils.validateArguments()
	if (!csvName) { csvName = "result" }
	let result = []
	let isLinkedInSearchSalesURL = isLinkedInSearchURL(searches)
	if (isLinkedInSearchSalesURL === 0) { // LinkedIn Sales Navigator Search
		searches = [ searches ]
	} else {
		if (isLinkedInSearchSalesURL === -1) { // Regular LinkedIn Search
			throw "Not a valid Sales Navigator Search Link"  
		} 
		try { 		// Link not from LinkedIn, trying to get CSV
			searches = await utils.getDataFromCsv(searches)
			searches = searches.filter(str => str) // removing empty lines
			result = await utils.getDb(csvName + ".csv")
			const lastUrl = searches[searches.length - 1]
			searches = searches.filter(str => checkDb(str, result))
			if (searches.length < 1) { searches = [lastUrl] } // if every search's already been done, we're executing the last one
		} catch (err) {
			if (searches.startsWith("http")) {
				utils.log("Couln't open CSV, make sure it's public", "error")
				nick.exit(1)
			}
			searches = [ searches ] 
		}
	}
	utils.log(`Search : ${JSON.stringify(searches, null, 2)}`, "done")
	await linkedIn.login(tab, sessionCookie)
	for (const search of searches) {
		if (search) {
			let searchUrl = ""
			const isSearchURL = isLinkedInSearchURL(search)

			if (isSearchURL === 0) { // LinkedIn Sales Navigator Search
				searchUrl = forceCount(search)
			} else if (isSearchURL === 1) { // Not a URL -> Simple search
				searchUrl = createUrl(search, circles)
			} else {  
				utils.log(`${search} doesn't constitute a LinkedIn Sales Navigator search URL or a LinkedIn search keyword... skipping entry`, "warning")
				continue
			}
			result = result.concat(await getSearchResults(tab, searchUrl, numberOfProfiles, search))
		} else {
			utils.log("Empty line... skipping entry", "warning")
		}
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
	}
	utils.saveResult(result)
})()
	.catch(err => {
		utils.log(err, "error")
		nick.exit(1)
	})
