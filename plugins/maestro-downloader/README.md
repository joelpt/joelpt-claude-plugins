This is a Claude Code plugin which provides a video downloader functionality for BBC Maestro.

## Supported commands:

/setup - initializes a .env file if it doesn't exist in the plugin's folder (under ~/.claude/plugins/...). Allow specification of username and password to use when accessing BBC Maestro website plus the root folder under which all downloaded courses will be placed (<root folder>/courses/<name of course>/...)

/list - presents a list of all the currently available bbc maestro courses, broken down by category

/download - performs the download and offline preparation for a given named course


## How download mechanism works:  

1. The specified course's content index is discovered and recorded in its dedicated /courses/<ConciseCourseTitle>/ folder (hereafter referred to as cf) as config.json. Each course may have one or more categories of videos, for example "Course" and "Vocal Exercises" categories might exist for a course on singing; this varies uniquely per course. This json is also used to keep track of which videos have been downloaded so far.
2. The videos will be downloaded to cf/videos/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.av1. BBC Maestro may deliver videos as a series of small .ts files which need to be merged into a single video file; each video file also should be transformed to AV1 format if it is not already in AV1 using ffmpeg and best practice settings for high fidelity (minimal practical lossiness without going overboard). Rerunning /download will cause the plugin to resume its work if there were any not-yet-downloaded videos. Once a video is downloaded, merged, converted, and saved, it's marked as complete in the .json. 
   - intelligent rate limiting with exponential backoff & jitter.
   - MVP: purely sequential downloading. Downloading should be performed using a headless (or if necessary, headed) browser, downloading each video in a course in turn. Since BBC Maestro delivers videos as a sequence of .ts files it may be necessary to kick off downloads using the standard in-page controls. After each successful full video (.ts series) download -> merge -> convert -> save, we can start the next one: the pause between each such download task will help avoid rate limiting constraints.

## UI features:

1. There shall be a master index page at cf/index.html. There shall be a master downloaded-courses list at cf/index.json which index.html reads to present the available-downloaded-courses index to the user. index.json won't be populated until all the videos have been downloaded for a given course.
2. Clicking on a given courses's tile in cf/index.html will direct the user to an individual course's index page. cf/index.html shall also be reponsible for showing these pages using something like cf/index.html?course=<ConciseCourseTitle>. All categories and their videos will be shown in a single page ((categories -> videos).
3. Click on an individual video will open a viewer for the video using something like cf/index.html?video=<ConciseCourseTitle/ConciseCategoryTitle/IndexNumber-ConciseVideoTitle.av1>.