(function() {
	'use strict';

	var log = require(process.cwd() + '/build/server/logging.js').getLogger('handlers/RequisitionChangedHandler.js');
	var objectTools = require(process.cwd() + '/build/server/ObjectTools.js');
	var universalDaoModule = require(process.cwd() + '/build/server/UniversalDao.js');
	var dateUtils = require(process.cwd()+'/build/server/DateUtils.js').DateUtils;
	var QueryFilter = require(process.cwd()+'/build/server/QueryFilter.js');

	var nodemailer = module.parent.require('nodemailer');
	var renderModule =  module.parent.require('./renderService.js');
	var transport = nodemailer.createTransport('Sendmail');


	/**
	*	@module server
	*	@submodule event.handler
	*	@class RequisitionChangedHandler
	*/
	function RequisitionChangedHandler(ctx) {
		this.ctx=ctx;
		var self=this;
		var renderService = new renderModule.RenderService();

		var requisitionsDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: 'requisitions'}
		);

		var userDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: 'people'}
		);

		/**
			Method handles <b>event-requisition-created<b> event.
			<br>Method does:
			<li>updates/initializes requisitions attributes setupDate,applicant,status,assignedTo</li>
			<li>sends notification mail to cfg defined issue solver ('requisitionSolverAddress') </li>
			<br>
			Limitations: requisitionSolverAddress should match to systemCredentials.login.email of any user othewise attribute 'assignedTo' is not resolved.

			@method handleRequisitionCreated

		*/
		this.handleRequisitionCreated=function(event){

			var entity = event.entity;
			var solverAddress=this.ctx.config.mails.requisitionSolverAddress;
			
			console.log('mmmmmmmmmmmmmm: ' + JSON.stringify(event));

				entity.requisitionData = {};
				entity.requisitionData.setupDate=dateUtils.nowToReverse();
				entity.requisitionData.status='created';
				entity.requisitionData.applicant={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:event.user.id};
				entity.requisitionData.clubApplicant={schema:"uri://registries/organizations#views/club-km/view",registry:'organizations',oid:event.user.officer.club.oid};


				var qf=QueryFilter.create();
				qf.addCriterium("systemCredentials.login.email","eq",solverAddress);

				userDao.find(qf, function(err, data) {
					if (err){
						log.error(err);
						return;
					}

					// assign to and send mail.
					if (data.length==1){
						var solver=data[0];
						
							entity.requisitionData.assignedTo={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:solver.id};
						
						
					}
					self.sendRequisitionCreated(solverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requisitionData.subject,self.ctx.config.serviceUrl+'/requisitions/'+entity.id);

					requisitionsDao.save(entity,function(err,data){
						if (err) {
							log.error(err);
							return;
						}
						log.debug('requisitions created: event handled');
					});

				});

		};

		/**
			Method handles <b>event-requisition-updated</b>
			@method handleRequisitionModified
		*/
		this.handleRequisitionModified=function(event){

			var entity = event.entity;
			// var solverAddress=this.ctx.config.mails.requisitionSolverAddress;

			// if (entity.requisitionData) {

			entity.requisitionData.applicant={schema:"uri://registries/people#views/fullperson/view",registry:'people',oid:event.user.id};
			var solverAddress=self.ctx.config.mails.requisitionSolverAddress;

				if (entity.requisitionData.assignedTo){
					userDao.get(entity.requisitionData.assignedTo.oid, function(err, solver) {
						if (err){
							log.error(err);
							return;
						}

						// assign to and send mail.
						if (solver){
							self.sendRequisitionModified(solver.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requisitionData.subject,self.ctx.config.serviceUrl+'/requisitions/'+entity.id);
						}
					});

				} else {
					self.sendRequisitionModified(this.ctx.config.mails.requisitionSolverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requisitionData.subject,self.ctx.config.serviceUrl+'/requisitions/'+entity.id);
				}

				if (entity.requisitionData.applicant){
							userDao.get(entity.requisitionData.applicant.oid,function(err,applicant){
								if (err){
									log.error(err);
									return;
								}
								self.sendRequisitionModified(applicant.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requisitionData.subject,self.ctx.config.serviceUrl+'/requisitions/'+entity.id);
							});
				}
			// }
		}


		this.sendRequisitionCreated=function(email,serviceUrl,applicant,subject,requisitionUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Nová žiadosť',
				html : renderService.render(renderModule.templates.REQUISITION_CREATED_HTML,{applicant:applicant,subject:subject,serviceUrl:serviceUrl,requisitionUri:requisitionUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};
		this.sendRequisitionModified=function(email,serviceUrl,modifier,subject,requisitionUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Upravená žiadosť',
				html : renderService.render(renderModule.templates.REQUISITION_UPDATED_HTML,{modifier:modifier,subject:subject,serviceUrl:serviceUrl,requisitionUri:requisitionUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};

	}
	/**
	* method dispatch all types of registered events to actual handling method.
	* @method handle
	*/
	RequisitionChangedHandler.prototype.handle = function(event) {
		log.info('handle called',event,RequisitionChangedHandler.prototype.ctx);

		if ('event-requisition-created' === event.eventType){
			this.handleRequisitionCreated(event);
		}else if ('event-requisition-updated' === event.eventType){
			this.handleRequisitionModified(event);
		}
	};

	RequisitionChangedHandler.prototype.getType=function(){
		return ["event-requisition-created","event-requisition-updated"];
	};

	module.exports = function( ctx) {
		return new RequisitionChangedHandler(ctx );
	};
}());
