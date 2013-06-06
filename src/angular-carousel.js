/*global angular, console, $*/

"use strict";

/*
Angular touch carousel with CSS GPU accel and slide buffering
http://github.com/revolunet/angular-carousel
*/

angular.module('angular-carousel', ['ngMobile'])
  .filter('carouselSlice', function() {
    return function(arr, start, end) {
      return arr.slice(start, end);
    };
  })
  .directive('rnCarousel', ['$compile', '$parse', '$swipe', function($compile, $parse, $swipe) {
    /* track number of carousel instances */
    var carousels = 0;

    return {
      restrict: 'A',
      scope: true,
      compile: function(tElement, tAttrs) {

        tElement.addClass('rn-carousel-slides');

        /* extract the ngRepeat expression from the first li attribute
           this expression will be used to update the carousel
           buffered carousels will add a slice operator to that expression

           TODO: handle various ng-repeat syntaxes
        */
        var liAttribute = tElement.find('li')[0].attributes['ng-repeat'],
            exprMatch = liAttribute.value.match( /^([^\s]+) in (.+)$/i ),
            originalItem = exprMatch[1],
            originalCollection = exprMatch[2],
            isBuffered = angular.isDefined(tAttrs['rnCarouselBuffered']);

        if (isBuffered) {
          /* update the current ngRepeat expression and add a slice operator */
          var sliceExpression = '|carouselSlice:carouselBufferStart:carouselBufferStart+carouselBufferSize';
          liAttribute.value = originalItem + ' in carouselItems' + sliceExpression;
        }

        return function(scope, iElement, iAttrs, controller) {

          carousels++;
          var carouselId = 'rn-carousel-' + carousels,
              swiping = 0,
              startX = 0,
              startOffset  = 0,
              offset  = 0,
              minSwipePercentage = 0.1,
              containerWidth = 0,
              initialPosition = true,
              restoredPosition = false;

          /* add a wrapper div that will hide the overflow */
          var carousel = iElement.wrap("<div id='" + carouselId +"' class='rn-carousel-container'></div>"),
              container = carousel.parent();

          scope.carouselItems = [];       // internal collection
          scope.carouselBufferStart = 0;  // index of the buffer start, if any, relative to the whole collection
          scope.totalIndex = 0;           // index of the active slide, relative to the whole collection
          scope.activeIndex = 0;          // index of the active slide, relative to the buffered collection (may be buffered)

          function debug(msg) {
            /* useful debug info */
            console.group(msg);
            console.log({
              restoredPosition: restoredPosition,
              initialPosition: initialPosition,
              containerWidth: containerWidth,
              carouselItems: scope.carouselItems,
              carouselBufferStart: scope.carouselBufferStart,
              totalIndex: scope.totalIndex,
              activeIndex: scope.activeIndex
            });
            console.groupEnd();
          }

          function updateCarouselPadding() {
            /* replace the removed DOM elements with an absolute left positionning
               we cannot use padding/margin here as it won't work with percentages based containers
            */
            carousel.addClass('rn-carousel-noanimate').css({
              'left': (scope.carouselBufferStart * containerWidth) + 'px'
            });
          }

         //var edgeDistance = 1; // how many slides to trigger edge detection
          function isLeftEdge() {
            /* check if we reached buffer left edge and we're not at the first item in collection */
            return (scope.totalIndex > 0 && scope.activeIndex === 0);
          }

          function isRightEdge() {
            /* check if we reached the buffer right edge */
            var isLastActiveItem = scope.activeIndex === (carousel.find('li').length - 1);
            return isLastActiveItem;
            // && !isLastCollectionItem);
          }

          var collectionModifiers = {
            /* add slided before/after for the bufferef carousel */
            add: function(action, items) {
              /* action is append or prepend */
              if (items) {
                /* add returned slides at the end of the collection */
                if (angular.isObject(items.promise)) {
                  items.promise.then(function(items) {
                    collectionModifiers[action](items);
                  });
                } else {
                  collectionModifiers[action](items);
                }
              }
            },
            append: function(items) {
              /* append items to the current collection */
              if (angular.isArray(items)) {
                scope.carouselItems = scope.carouselItems.concat(items);
              } else {
                scope.carouselItems.push(items);
              }
            },
            prepend: function(items) {
              /* prepend items to the current collection and update indexes accordingly */
              initialPosition = true;
              var itemsOffset = 1;
              if (angular.isArray(items)) {
                itemsOffset = items.length;
                scope.carouselItems = items.concat(scope.carouselItems);
              } else {
                scope.carouselItems.splice(0, 0, items);
              }
              scope.carouselBufferStart -= itemsOffset;
              scope.totalIndex += itemsOffset;
              updateActiveIndex();

              // this should be called only if we're NOT inside an digest cycle
              if(!scope.$$phase) {
                updateSlidePosition();
              }
            }
          };

          function transitionEndCallback() {
            checkEdges();
          }

          function checkEdges(transitioned) {
            /* check carousel edges :
                - check if we need to update the DOM (add/remove slides)
                - check if we need to use callbacks to get new slides
            */
            if (!isBuffered) return;
            var slidesInCache = false;
            if (isRightEdge()) {
              scope.$apply(function() {
                scope.carouselBufferStart += 1;
                updateCarouselPadding();
              });
              /* check if we really need to use the callback to get more slides */
              slidesInCache = (getSlidesCount() - 1 > scope.totalIndex + 1);
              if (!slidesInCache && angular.isDefined(iAttrs.rnCarouselNext)) {
                var slidesAfter = $parse(iAttrs.rnCarouselNext)(scope, {
                  index: (scope.totalIndex + 1),
                  item: scope.carouselItems[scope.carouselItems.length-1]
                });
                /* add returned slides at the end of the collection */
                collectionModifiers.add('append', slidesAfter);
              }
            }
            if (isLeftEdge()) {
              scope.$apply(function() {
                scope.carouselBufferStart -= 1;
                updateCarouselPadding();
              });
              /* check if we really need to use the callback to get more slides */
              slidesInCache = (scope.carouselBufferStart > 0);
              if (!slidesInCache && angular.isDefined(iAttrs.rnCarouselPrev)) {
                var slidesBefore = $parse(iAttrs.rnCarouselPrev)(scope, {
                  index: 0,
                  item: scope.carouselItems[0]
                });
                /* add returned slides at the beginning of the collection */
                collectionModifiers.add('prepend', slidesBefore);
              }
            }
          }

          var vendorPrefixes = ["webkit", "moz"];
          function getCSSProperty(property, value) {
            /* cross browser CSS properties generator */
            var css = {};
            css[property] = value;
            angular.forEach(vendorPrefixes, function(prefix, idx) {
              css['-' + prefix.toLowerCase() + '-' + property] = value;
            });
            return css;
          }
          function translateSlideproperty(offset) {
            return getCSSProperty('transform', 'translate3d(' + offset + 'px,0,0)');
            //matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ' + offset + ', 0, 0, 1)');
          }

          if (isBuffered) {
            /* buffered carousels listen transitionEnd CSS events to update the DOM */
            scope.carouselBufferSize = 3;
            carousel[0].addEventListener('webkitTransitionEnd', transitionEndCallback, false);  // webkit
            carousel[0].addEventListener('transitionend', transitionEndCallback, false);        // mozilla
            scope.$watch('carouselBufferStart', function(newValue, oldValue) {
              updateActiveIndex();
            });
          }

          function updateActiveIndex() {
            /* update the activeIndex (visible slide) based on the current collection 
               can be used to compare with $index in your carousel template
            */
            scope.activeIndex = scope.totalIndex - scope.carouselBufferStart;
          }

          /* handle rn-carousel-index attribute data binding */
          if (iAttrs.rnCarouselIndex) {
              var indexModel = $parse(iAttrs.rnCarouselIndex);
              if (angular.isFunction(indexModel.assign)) {
                /* check if this property is assignable then watch it */
                scope.$watch('totalIndex', function(newValue) {
                  indexModel.assign(scope.$parent, newValue);
                });
                scope.$parent.$watch(indexModel, function(newValue, oldValue) {
                  scope.totalIndex = Math.max(0, newValue);
                });
              } else if (!isNaN(iAttrs.rnCarouselIndex)) {
                /* if user just set an initial number, set it */
                scope.totalIndex = Math.max(0, parseInt(iAttrs.rnCarouselIndex, 10));
              }
          }

          scope.$watch('totalIndex', function(newValue, oldValue) {
            if (newValue!==oldValue) {
              updateSlidePosition();
            }
            updateActiveIndex();
          });

          scope.$watch(originalCollection, function(newValue, oldValue) {
            /* when the whole original collection change
                - reset the carousel index and position
            */
            if (newValue!==oldValue) {
              scope.totalIndex = 0;
              if (isBuffered) {
                scope.carouselBufferStart = 0;
                updateCarouselPadding();
              }
            }
          });

          scope.$watch(originalCollection, function(newValue, oldValue) {
            /* when the original collection content change,
                - update local list reference
                - update container width based on first item width
            */
            scope.carouselItems = newValue;
            if (containerWidth === 0) {
              var slides = carousel.find('li');
              if (slides.length === 0) {
                containerWidth = carousel[0].getBoundingClientRect().width;
              } else {
                containerWidth = slides[0].getBoundingClientRect().width;
              }
              container.css('width', containerWidth + 'px');
              updateSlidePosition();
            }
          }, true);

          /* enable carousel indicator */
          if (angular.isDefined(iAttrs.rnCarouselIndicator)) {
            var indicator = $compile("<div id='" + carouselId +"-indicator' index='totalIndex' items='carouselItems' data-rn-carousel-indicators class='rn-carousel-indicator'></div>")(scope);
            container.append(indicator);
          }

          var getSlidesCount = function() {
              /* returns the total number of items in the carousel */
              return scope.carouselItems.length;
          };

          var updateSlidePosition = function() {
            /* trigger carousel position update */
            var skipAnimation = (initialPosition===true),
                slidesCount = getSlidesCount();
            /* check we're not out of bounds */
            if (scope.totalIndex > slidesCount - 1) {
              scope.totalIndex = slidesCount - 1;
            }
            if (scope.totalIndex < 0) {
              scope.totalIndex = 0;
            }
            /* check if requested position is out of buffer */
            if (isBuffered) {
              if (
                  (scope.totalIndex < scope.carouselBufferStart) || 
                  (scope.totalIndex > (scope.carouselBufferStart + scope.carouselBufferSize - 1))
                  ) {
                  /* update carousel position without animating */
                  scope.carouselBufferStart = Math.max(0, scope.totalIndex - 1);
                  skipAnimation = true;
                  updateCarouselPadding();
              }
              var bufferStart = Math.max(0, Math.min(scope.carouselBufferStart, slidesCount - scope.carouselBufferSize));
              /* ensure buffer start is never negative and never too high */
              scope.carouselBufferStart = bufferStart;
            }
            offset = scope.totalIndex * -containerWidth;
            if (skipAnimation===true) {
                carousel.addClass('rn-carousel-noanimate')
                    .css(translateSlideproperty(offset));
            } else {
                carousel.removeClass('rn-carousel-noanimate')
                    .addClass('rn-carousel-animate')
                    .css(translateSlideproperty(offset));
            }
            initialPosition = false;
          };

          $swipe.bind(carousel, {
            /* use angular $swipe service */
            start: function(coords) {
              /* capture initial event position */
              if (swiping === 0) {
                swiping = 1;
                startX = coords.x;
              }
            },
            move: function (coords) {
              if (swiping===0) return;
              var deltaX = coords.x - startX;
              if (swiping === 1 && deltaX !== 0) {
                swiping = 2;
                startOffset = offset;
              }
              else if (swiping === 2) {
                var slideCount = getSlidesCount();
                /* ratio is used for the 'rubber band' effect */
                var ratio = 1;
                if ((scope.totalIndex === 0 && coords.x > startX) || (scope.totalIndex === slideCount - 1 && coords.x < startX))
                  ratio = 3;
                /* follow cursor movement */
                offset = startOffset + deltaX / ratio;
                carousel.css(translateSlideproperty(offset))
                        .removeClass()
                        .addClass('rn-carousel-noanimate');
              }
            },
            end: function (coords) {
              /* when movement ends, go to next slide or stay on the same */
              if (swiping > 0) {
                restoredPosition = false;
                swiping = 0;
                var slideCount = getSlidesCount(),
                    slideOffset = (offset < startOffset)?1:-1,
                    tmpSlideIndex = Math.min(Math.max(0, scope.totalIndex + slideOffset), slideCount - 1);

                var delta = coords.x - startX;
                if (Math.abs(delta) <= containerWidth * minSwipePercentage) {
                  /* prevent swipe if not swipped enough */
                  tmpSlideIndex = scope.totalIndex;
                }
                var changed = (scope.totalIndex !== tmpSlideIndex);
                
                /* reset slide position if same slide (watch not triggered) */
                if (!changed) {
                  restoredPosition = true,
                  updateSlidePosition();
                } else {
                  scope.$apply(function() {
                    scope.totalIndex = tmpSlideIndex;
                  });
                }
              }
            }
          });
        };
      }
    };
  }])
  .directive('rnCarouselIndicators', [function() {
    return {
      restrict: 'A',
      replace: true,
      scope: {
        items: '=',
        index: '='
      },
      template: '<div class="rn-carousel-indicator">' +
                  '<span ng-repeat="item in items" ng-class="{active: $index==$parent.index}">●</span>' +
                '</div>'
    };
  }]);
