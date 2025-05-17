function hrefLink(url) {
    location.href = url;
}

function goCategoryPage(category) {
    const categoryName = category.toLowerCase();
    location.href = "/categories/#" + categoryName;
}

